// =============================================================
// Polymarket WebSocket (Real-time Prices + Trades)
// =============================================================
//
// WHAT: Maintains a persistent WebSocket connection to Polymarket's
//       CLOB (Central Limit Order Book) service for real-time
//       price updates and trade notifications.
//
// WHY:  Polling APIs every minute means up to 60 seconds of delay.
//       WebSocket gives us INSTANT updates — the moment a price
//       changes or a trade happens, we know. This is critical for:
//       - Real-time whale detection (whale buys → we know in <1s)
//       - Live price feeds on the dashboard
//       - Copy trading latency (faster detection = better copy price)
//
// URL:  wss://ws-subscriptions-clob.polymarket.com/ws/market
//       No authentication required for read-only subscriptions.
//
// PROTOCOL:
//   1. Connect to WebSocket
//   2. Send subscription: { type: "market", assets_ids: ["token_id1", ...], custom_feature_enabled: true }
//   3. Send "PING" every 10 seconds (required — server drops connection otherwise)
//   4. Receive real-time updates as JSON messages
//   5. Handle reconnection on disconnect (exponential backoff)
//
// EVENT TYPES:
//   - book: Order book snapshot (on subscribe + after trades)
//   - price_change: Order book level update (changes array with price/side/size)
//   - last_trade_price: Trade execution (asset_id, price, size in shares, side)
//   - tick_size_change: Min tick size adjusts
//   - best_bid_ask: Best bid/ask changes (requires custom_feature_enabled)
//   - new_market: New market launched (requires custom_feature_enabled)
//   - market_resolved: Market resolved (requires custom_feature_enabled)
//
// IMPORTANT: assets_ids are ERC-1155 TOKEN IDs (long numeric strings),
//            NOT condition_ids. Each market has 2 token IDs (YES + NO).
//            Max 500 token IDs per connection.
//
// DOCS: https://docs.polymarket.com/developers/CLOB/websocket/market-channel
// =============================================================

import WebSocket from 'ws';
import { redis } from '../db/redis';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';
import { db } from '../db/postgres';
import { REDIS_KEYS, TRADE_SIZE_TIERS } from '@markypie/shared';
import { sendWhaleAlert, sendNewMarketAlert, sendMarketResolvedAlert } from '../alerts/telegram';

const log = createLogger('polymarket-ws');

let ws: WebSocket | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50;
const BASE_RECONNECT_DELAY_MS = 1000; // 1 second, doubles each attempt
const PING_INTERVAL_MS = 10_000; // Polymarket requires PING every 10 seconds

/**
 * Subscribes to market updates via the Polymarket CLOB WebSocket.
 *
 * The CLOB WebSocket requires `assets_ids` — these are ERC-1155 token IDs
 * (long numeric strings like "21742633143463906290569050155826241533067272736897614950488156847949938836455"),
 * NOT condition IDs. Each market has 2 token IDs (one for YES, one for NO).
 *
 * We store these in the `token_ids` column on the markets table,
 * populated from the Gamma API's `clobTokenIds` field during market sync.
 *
 * Limit: max 500 assets_ids per connection. We subscribe to top 200 markets
 * (= up to 400 token IDs) to stay safely within the limit.
 */
export async function subscribeToMarkets(): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Get token IDs from our most active Polymarket markets
  // token_ids is a TEXT[] column containing the ERC-1155 token IDs
  const result = await db.query(
    `SELECT token_ids FROM markets
     WHERE platform = 'polymarket' AND status = 'active'
       AND volume > 0 AND token_ids IS NOT NULL
     ORDER BY volume DESC LIMIT 200`
  );

  // Flatten all token IDs into a single array
  // Each market has 2 token IDs (YES + NO), so up to 400 total
  const allTokenIds: string[] = [];
  for (const row of result.rows) {
    if (Array.isArray(row.token_ids)) {
      allTokenIds.push(...row.token_ids);
    }
  }

  if (allTokenIds.length === 0) {
    log.warn('No token IDs found — markets may not have been synced yet. WebSocket will subscribe after next market sync.');
    return;
  }

  log.info({ tokenIds: allTokenIds.length, markets: result.rows.length }, 'Subscribing to Polymarket markets via WebSocket');

  try {
    ws.send(JSON.stringify({
      type: 'market',
      assets_ids: allTokenIds,
      custom_feature_enabled: true,  // Enables best_bid_ask, new_market, market_resolved events
    }));
  } catch (err) {
    log.warn({ err }, 'Failed to send WebSocket subscription');
  }
}

/**
 * Starts the PING heartbeat.
 *
 * Polymarket CLOB WebSocket requires the client to send a text "PING"
 * every 10 seconds. Server responds with "PONG". Without this,
 * the server drops the connection after ~30 seconds.
 */
function startPingHeartbeat(): void {
  stopPingHeartbeat();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send('PING');
    }
  }, PING_INTERVAL_MS);
}

function stopPingHeartbeat(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

/**
 * Handles incoming WebSocket messages.
 *
 * Messages come as JSON with an `event_type` field.
 * We handle: price_change, last_trade_price, book, new_market, market_resolved.
 */
async function handleMessage(data: string): Promise<void> {
  // Handle PONG response to our PING
  if (data === 'PONG') return;

  // Skip other non-JSON messages (e.g., "OK", "INVALID OPERATION")
  if (!data.startsWith('{') && !data.startsWith('[')) {
    if (data !== 'OK') {
      log.debug({ data }, 'Non-JSON WebSocket message');
    }
    return;
  }

  try {
    const message = JSON.parse(data);

    switch (message.event_type) {
      case 'price_change':
        await handlePriceChange(message);
        break;

      case 'last_trade_price':
        await handleLastTradePrice(message);
        break;

      case 'best_bid_ask':
        // Best bid/ask update — cache for live price display
        if (message.asset_id) {
          const bid = parseFloat(message.best_bid || '0');
          const ask = parseFloat(message.best_ask || '0');
          if (bid > 0 && ask > 0) {
            await redis.set(
              REDIS_KEYS.marketPrice('polymarket', message.asset_id),
              JSON.stringify({
                price: (bid + ask) / 2,
                best_bid: bid,
                best_ask: ask,
                updated_at: Date.now(),
              }),
              'EX', 300
            );
          }
        }
        break;

      case 'book':
        // Order book snapshot — received on subscribe + after trades
        log.debug({ asset: message.asset_id }, 'Received order book snapshot');
        break;

      case 'new_market':
        log.info({ question: message.question, market: message.market }, 'New market detected via WebSocket');
        if (message.question) {
          sendNewMarketAlert({
            title: message.question,
            platform: 'Polymarket',
            category: message.category || undefined,
          }).catch(err => log.error({ err }, 'Telegram new market alert failed'));
        }
        break;

      case 'market_resolved':
        log.info({
          question: message.question,
          winner: message.winning_outcome,
          market: message.market,
        }, 'Market resolved via WebSocket');
        if (message.question) {
          sendMarketResolvedAlert({
            title: message.question,
            outcome: message.winning_outcome || 'UNKNOWN',
            platform: 'Polymarket',
          }).catch(err => log.error({ err }, 'Telegram resolved alert failed'));
        }
        break;

      default:
        log.debug({ event_type: message.event_type }, 'Unknown WebSocket event type');
    }
  } catch (err) {
    log.error({ err, data: data.substring(0, 200) }, 'Failed to handle WebSocket message');
  }
}

/**
 * Handles price_change events.
 *
 * Message format (post Sept 2025 migration):
 * {
 *   event_type: "price_change",
 *   asset_id: "71321045...",
 *   market: "0x5f651...",
 *   changes: [{ price: "0.4", side: "SELL", size: "3300" }],
 *   timestamp: "1729084877448"
 * }
 *
 * A size of "0" means that price level was removed from the order book.
 * The `changes` array shows which price levels changed.
 */
async function handlePriceChange(message: any): Promise<void> {
  const assetId = message.asset_id;
  const marketConditionId = message.market;

  // Extract the best price from changes
  // We look for the best bid (highest BUY price) as a proxy for the current price
  const changes = message.changes || message.price_changes || [];

  if (changes.length === 0 || !assetId) return;

  // If best_bid/best_ask are available in price_changes entries, use those
  let bestBid: number | null = null;
  let bestAsk: number | null = null;

  for (const change of changes) {
    if (change.best_bid) bestBid = parseFloat(change.best_bid);
    if (change.best_ask) bestAsk = parseFloat(change.best_ask);
  }

  // Calculate midpoint price for Redis cache
  let midPrice: number | null = null;
  if (bestBid !== null && bestAsk !== null) {
    midPrice = (bestBid + bestAsk) / 2;
  } else if (changes[0]?.price) {
    // Fallback: use the price from the first change
    midPrice = parseFloat(changes[0].price);
  }

  if (midPrice && midPrice > 0 && midPrice <= 1) {
    // Cache price by asset_id (token ID)
    await redis.set(
      REDIS_KEYS.marketPrice('polymarket', assetId),
      JSON.stringify({
        price: midPrice,
        best_bid: bestBid,
        best_ask: bestAsk,
        updated_at: Date.now(),
      }),
      'EX', 300 // Expire after 5 minutes
    );

    // Also cache by condition ID (market ID) if available
    if (marketConditionId) {
      await redis.set(
        REDIS_KEYS.marketPrice('polymarket', marketConditionId),
        JSON.stringify({
          price: midPrice,
          best_bid: bestBid,
          best_ask: bestAsk,
          updated_at: Date.now(),
        }),
        'EX', 300
      );
    }
  }
}

/**
 * Handles last_trade_price events (trade execution).
 *
 * Message format:
 * {
 *   event_type: "last_trade_price",
 *   asset_id: "114122071...",
 *   market: "0x6a67b...",
 *   price: "0.456",
 *   size: "219.217767",   // NUMBER OF SHARES (not USD!)
 *   side: "BUY",
 *   fee_rate_bps: "0",
 *   timestamp: "1750428146322"
 * }
 *
 * IMPORTANT: `size` is shares traded, not USD value.
 * USD value = size * price.
 * For whale detection we need USD value.
 */
async function handleLastTradePrice(message: any): Promise<void> {
  const shares = parseFloat(message.size || '0');
  const price = parseFloat(message.price || '0');
  const usdValue = shares * price;

  // Cache the latest trade price
  if (message.asset_id && price > 0) {
    await redis.set(
      REDIS_KEYS.marketPrice('polymarket', message.asset_id),
      JSON.stringify({
        price,
        last_trade_size: shares,
        updated_at: Date.now(),
      }),
      'EX', 300
    );
  }

  // Check for whale trade (USD value, not shares)
  if (usdValue >= env.WHALE_THRESHOLD) {
    // Look up which token (YES/NO) this asset_id belongs to, plus market title
    // token_ids[1] = YES token, token_ids[2] = NO token (PostgreSQL is 1-indexed)
    let outcome = 'UNKNOWN';
    let marketTitle = '';
    let marketDbId: string | null = null;

    if (message.asset_id) {
      const lookup = await db.query(
        `SELECT id, title,
          CASE
            WHEN token_ids[1] = $1 THEN 'YES'
            WHEN token_ids[2] = $1 THEN 'NO'
            ELSE 'UNKNOWN'
          END as outcome
        FROM markets
        WHERE $1 = ANY(token_ids)
        LIMIT 1`,
        [message.asset_id]
      );

      if (lookup.rows.length > 0) {
        outcome = lookup.rows[0].outcome;
        marketTitle = lookup.rows[0].title;
        marketDbId = lookup.rows[0].id;
      }
    }

    log.info(
      {
        usdValue: usdValue.toFixed(2),
        shares,
        price,
        side: message.side,
        outcome,
        market: marketTitle || message.market,
      },
      'Whale trade detected via WebSocket'
    );

    await redis.lpush(
      REDIS_KEYS.whaleFeed,
      JSON.stringify({
        wallet_address: 'unknown', // WebSocket doesn't provide trader address
        side: message.side || 'BUY',
        outcome,
        price,
        size: usdValue,
        shares,
        market_id: marketDbId || message.market || message.asset_id,
        market_title: marketTitle,
        timestamp: parseInt(message.timestamp) || Date.now(),
        source: 'websocket',
      })
    );
    await redis.ltrim(REDIS_KEYS.whaleFeed, 0, 99);

    // Telegram whale alert skipped here — WebSocket doesn't provide wallet address.
    // The polling job (polymarket-trades.ts) sends whale alerts with proper wallet info.
  }
}

/**
 * Connects to Polymarket CLOB WebSocket with auto-reconnection.
 *
 * Reconnection strategy: exponential backoff
 * Attempt 1: wait 1s, Attempt 2: wait 2s, Attempt 3: wait 4s...
 * Max delay: 30 seconds. Max attempts: 50.
 */
export async function connectPolymarketWebSocket(): Promise<void> {
  log.info('Connecting to Polymarket WebSocket...');

  ws = new WebSocket(env.POLYMARKET_CLOB_WS);

  ws.on('open', async () => {
    log.info('Polymarket WebSocket connected');
    reconnectAttempts = 0;

    // Start PING heartbeat (required every 10 seconds)
    startPingHeartbeat();

    // Subscribe to active markets
    await subscribeToMarkets();
  });

  ws.on('message', async (data: WebSocket.Data) => {
    await handleMessage(data.toString());
  });

  ws.on('error', (err) => {
    log.error({ err }, 'Polymarket WebSocket error');
  });

  ws.on('close', (code, reason) => {
    log.warn({ code, reason: reason.toString() }, 'Polymarket WebSocket closed');
    stopPingHeartbeat();

    // Auto-reconnect with exponential backoff
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
        30000 // Max 30 seconds
      );
      reconnectAttempts++;
      log.info({ attempt: reconnectAttempts, delayMs: delay }, 'Reconnecting...');
      setTimeout(() => connectPolymarketWebSocket(), delay);
    } else {
      log.error('Max reconnection attempts reached. WebSocket will not reconnect.');
    }
  });
}

/**
 * Gracefully close the WebSocket connection.
 */
export function closePolymarketWebSocket(): void {
  stopPingHeartbeat();
  if (ws) {
    ws.close();
    ws = null;
    log.info('Polymarket WebSocket closed');
  }
}
