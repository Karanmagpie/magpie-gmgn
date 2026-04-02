// =============================================================
// Telegram Alert System
// =============================================================
//
// WHAT: Sends real-time alerts to Telegram groups/channels when
//       significant events happen on prediction markets.
//
// ALERT TYPES:
//   1. Whale Trade     — Trade >= $10K detected (side, price, market)
//   2. Arbitrage Found — Cross-platform spread > 2% detected
//   3. New Market      — New market launched on Polymarket
//   4. Market Resolved — Market outcome decided
//   5. Smart Money Shift — Consensus flips YES↔NO on a market
//
// RATE LIMITING:
//   Telegram API allows ~30 msgs/sec to different chats, but
//   only ~20 msgs/min to the SAME group. We enforce 20/min
//   with a simple sliding window to avoid 429 errors.
//
// CONFIG:
//   TELEGRAM_BOT_TOKEN  — from @BotFather
//   TELEGRAM_CHAT_ID    — group/channel ID (negative for groups)
//   TELEGRAM_THREAD_ID  — optional topic/thread ID for supergroups
//
// USAGE:
//   import { sendWhaleAlert, sendArbitrageAlert, ... } from '../alerts/telegram';
//   await sendWhaleAlert({ ... });
// =============================================================

import { createLogger } from '../utils/logger';

const log = createLogger('telegram');

// ---- Config from env ----
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const THREAD_ID = process.env.TELEGRAM_THREAD_ID
  ? parseInt(process.env.TELEGRAM_THREAD_ID, 10)
  : null;

// ---- Rate Limiting (20 msgs/min per chat) ----
const MAX_MESSAGES_PER_MINUTE = 20;
const messageTimestamps: number[] = [];

function isRateLimited(): boolean {
  const now = Date.now();
  // Remove timestamps older than 1 minute
  while (messageTimestamps.length > 0 && messageTimestamps[0]! < now - 60_000) {
    messageTimestamps.shift();
  }
  return messageTimestamps.length >= MAX_MESSAGES_PER_MINUTE;
}

// =============================================================
// Core Send Function
// =============================================================

/**
 * Sends a message to Telegram using the Bot API.
 * Supports HTML parse mode for formatting.
 *
 * Uses native fetch (Node 22) — no axios dependency needed.
 */
async function sendMessage(text: string, chatId?: string, threadId?: number | null): Promise<boolean> {
  const token = BOT_TOKEN;
  const chat = chatId || CHAT_ID;

  if (!token || !chat) {
    log.debug('Telegram not configured (missing BOT_TOKEN or CHAT_ID), skipping alert');
    return false;
  }

  if (isRateLimited()) {
    log.warn('Telegram rate limit reached (20/min), skipping alert');
    return false;
  }

  const resolvedThreadId = threadId !== undefined ? threadId : THREAD_ID;

  const body: Record<string, any> = {
    chat_id: chat,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (resolvedThreadId) {
    body.message_thread_id = resolvedThreadId;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      log.error({ status: response.status, error: errorData }, 'Telegram API error');
      return false;
    }

    messageTimestamps.push(Date.now());
    return true;
  } catch (err) {
    log.error({ err }, 'Failed to send Telegram message');
    return false;
  }
}

// =============================================================
// Generic Send (for custom messages)
// =============================================================

/**
 * Send a custom message to any chat/thread.
 * Useful for one-off notifications or testing.
 */
export async function sendTelegramMessage(
  message: string,
  chatId?: string,
  threadId?: number | null
): Promise<boolean> {
  return sendMessage(message, chatId, threadId);
}

// =============================================================
// Alert Type 1: Whale Trade
// =============================================================

export interface WhaleAlertData {
  walletAddress: string;
  walletName?: string;       // pseudonym like "BTCGambler247"
  side: string;              // BUY or SELL
  outcome: string;           // YES or NO
  price: number;
  size: number;              // USD value
  marketTitle: string;
  tier: string;              // 'notable' | 'whale' | 'mega' | 'ultra'
  source?: string;           // 'api' | 'websocket'
}

/**
 * Sends whale trade alert.
 *
 * Example:
 * 🐋 WHALE TRADE — $45,000
 * 🟢 BUY YES @ $0.82
 * 📊 Will the Fed cut rates in June 2026?
 * 👤 BTCGambler247
 */
export async function sendWhaleAlert(data: WhaleAlertData): Promise<boolean> {
  // Skip alerts on resolved/dead markets (price < $0.01 = market is essentially over)
  if (data.price < 0.01 || data.price > 0.99) return false;

  const tierEmoji = data.tier === 'ultra' ? '🔴'
    : data.tier === 'mega' ? '🟠'
    : data.tier === 'whale' ? '🟡'
    : '⚪';

  const sideEmoji = data.side === 'BUY' ? '🟢' : '🔴';
  const tierLabel = data.tier.toUpperCase();
  const wallet = data.walletName || shortenAddress(data.walletAddress);

  const message = [
    `🐋 <b>${tierLabel} TRADE</b> ${tierEmoji} — <b>$${formatNumber(data.size)}</b>`,
    ``,
    `${sideEmoji} ${data.side} ${data.outcome} @ $${formatPrice(data.price)}`,
    ``,
    `📊 ${escapeHtml(data.marketTitle)}`,
    ``,
    `👤 ${escapeHtml(wallet)}`,
  ].join('\n');

  return sendMessage(message);
}

// =============================================================
// Alert Type 2: Arbitrage Opportunity
// =============================================================

export interface ArbitrageAlertData {
  polymarketTitle: string;
  kalshiTitle: string;
  polyPrice: number;         // YES price on Polymarket
  kalshiPrice: number;       // YES price on Kalshi
  spreadPct: number;         // spread as percentage
  polyVolume: number;
  kalshiVolume: number;
}

/**
 * Sends arbitrage opportunity alert.
 *
 * Example:
 * 💰 ARBITRAGE — 5.2% Spread
 * 📈 Polymarket: YES @ $0.42
 * 📉 Kalshi: YES @ $0.48
 * 📊 Will Trump win 2028?
 * 💵 Volume: $125K / $89K
 */
export async function sendArbitrageAlert(data: ArbitrageAlertData): Promise<boolean> {
  const spreadEmoji = data.spreadPct >= 10 ? '🔥' : data.spreadPct >= 5 ? '💰' : '📊';

  const message = [
    `${spreadEmoji} <b>ARBITRAGE</b> — <b>${data.spreadPct.toFixed(1)}% Spread</b>`,
    ``,
    `📈 Polymarket: YES @ $${data.polyPrice.toFixed(2)}`,
    `📉 Kalshi: YES @ $${data.kalshiPrice.toFixed(2)}`,
    ``,
    `📊 <b>${escapeHtml(data.polymarketTitle)}</b>`,
    `💵 Volume: $${formatNumber(data.polyVolume)} / $${formatNumber(data.kalshiVolume)}`,
  ].join('\n');

  return sendMessage(message);
}

// =============================================================
// Alert Type 3: New Market
// =============================================================

export interface NewMarketAlertData {
  title: string;
  platform: string;
  category?: string;
}

/**
 * Sends new market alert.
 *
 * Example:
 * 🆕 NEW MARKET
 * 📊 Will AI pass the Turing Test by 2027?
 * 🏷️ Technology | Polymarket
 */
export async function sendNewMarketAlert(data: NewMarketAlertData): Promise<boolean> {
  const message = [
    `🆕 <b>NEW MARKET</b>`,
    ``,
    `📊 ${escapeHtml(data.title)}`,
    ``,
    `🏷️ ${escapeHtml(data.category || 'Uncategorized')} | ${data.platform}`,
  ].join('\n');

  return sendMessage(message);
}

// =============================================================
// Alert Type 4: Market Resolved
// =============================================================

export interface MarketResolvedAlertData {
  title: string;
  outcome: string;           // 'YES' or 'NO'
  platform: string;
}

/**
 * Sends market resolved alert.
 *
 * Example:
 * ✅ MARKET RESOLVED → YES
 * 📊 Will the Fed cut rates in June 2026?
 */
export async function sendMarketResolvedAlert(data: MarketResolvedAlertData): Promise<boolean> {
  const outcomeEmoji = data.outcome === 'YES' ? '✅' : '❌';

  const message = [
    `${outcomeEmoji} <b>MARKET RESOLVED</b> → <b>${data.outcome}</b>`,
    ``,
    `📊 ${escapeHtml(data.title)}`,
    ``,
    `🏷️ ${data.platform}`,
  ].join('\n');

  return sendMessage(message);
}

// =============================================================
// Alert Type 5: Smart Money Consensus Shift
// =============================================================

export interface ConsensusShiftAlertData {
  marketTitle: string;
  marketId: string;
  previousYesPct: number;
  currentYesPct: number;
  smartWalletCount: number;
  totalSmartValue: number;
}

/**
 * Sends consensus shift alert when smart money flips direction.
 *
 * Example:
 * 🔄 SMART MONEY SHIFT
 * 📊 Will the Fed cut rates in June 2026?
 * 📉 YES: 72% → 38% (flipped to NO)
 * 🧠 12 smart wallets | $245K total
 */
export async function sendConsensusShiftAlert(data: ConsensusShiftAlertData): Promise<boolean> {
  const previousSide = data.previousYesPct >= 50 ? 'YES' : 'NO';
  const currentSide = data.currentYesPct >= 50 ? 'YES' : 'NO';

  // Only alert if the consensus actually flipped
  if (previousSide === currentSide) return false;

  const direction = currentSide === 'YES' ? '📈' : '📉';

  const message = [
    `🔄 <b>SMART MONEY SHIFT</b>`,
    ``,
    `📊 ${escapeHtml(data.marketTitle)}`,
    ``,
    `${direction} YES: ${data.previousYesPct.toFixed(0)}% → ${data.currentYesPct.toFixed(0)}% (flipped to <b>${currentSide}</b>)`,
    ``,
    `🧠 ${data.smartWalletCount} smart wallets | $${formatNumber(data.totalSmartValue)} total`,
  ].join('\n');

  return sendMessage(message);
}

// =============================================================
// Utility Functions
// =============================================================

/** Escape HTML special chars for Telegram HTML parse mode */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Shorten wallet address: 0x3e13...58c0 */
function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Format number: 1234 → "1.2K", 1234567 → "1.2M" */
function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toFixed(0);
}

/** Format price: shows more decimals for tiny prices */
function formatPrice(price: number): string {
  if (price < 0.01) return '$' + price.toFixed(4);
  return '$' + price.toFixed(2);
}

// =============================================================
// Health Check
// =============================================================

/** Check if Telegram alerts are configured */
export function isTelegramConfigured(): boolean {
  return !!(BOT_TOKEN && CHAT_ID);
}
