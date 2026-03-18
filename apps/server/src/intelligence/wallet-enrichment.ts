// =============================================================
// Wallet Trade History Enrichment
// =============================================================
//
// WHAT: Fetches trade history for tracked wallets from the
//       Polymarket Data API and stores them in our trades table.
//
// WHY:  The global trade ingestion only captures the latest trades.
//       Smart Score needs per-wallet trade history (win rate, ROI,
//       Sharpe) so we backfill each wallet's trades individually.
//
// HOW:  Runs every 5 minutes via BullMQ.
//       1. Get 20 wallets that haven't been enriched recently
//          (least recently enriched first — cycles through ALL wallets)
//       2. For each wallet: fetch 50 trades from Data API
//       3. Match trades to markets by title, insert into trades table
//       4. Mark wallet as enriched in Redis (24h TTL)
//
// API:  GET https://data-api.polymarket.com/trades?user={wallet}
//       No auth required. Rate limited — we add 150ms delay.
//
// RATE LIMITING:
//       20 wallets × 1 API call each × 150ms = ~3-5 seconds per run.
//       Full enrichment of 651 wallets takes ~33 runs (~2.75 hours).
//       After first pass, only re-enriches wallets whose 24h TTL expired.
// =============================================================

import { db } from '../db/postgres';
import { redis } from '../db/redis';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';
import { REDIS_KEYS, ENRICHMENT_CONFIG } from '@markypie/shared';

const log = createLogger('wallet-enrichment');

/**
 * Fetches trade history for a specific wallet from Polymarket Data API.
 * Fetches MAX_TRADES_PER_WALLET (50) trades in one API call.
 */
async function fetchWalletTrades(walletAddress: string): Promise<any[]> {
  const limit = ENRICHMENT_CONFIG.MAX_TRADES_PER_WALLET;
  const url = `${env.POLYMARKET_DATA_API}/trades?user=${walletAddress}&limit=${limit}&offset=0`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      log.warn({ status: response.status, wallet: walletAddress }, 'Failed to fetch wallet trades');
      return [];
    }

    const data = (await response.json()) as any;
    const trades = Array.isArray(data) ? data : data.data || [];
    return trades.slice(0, limit);
  } catch (err) {
    log.warn({ err, wallet: walletAddress }, 'Error fetching wallet trades');
    return [];
  }
}

// Cache for market ID lookups to avoid repeated DB queries
const marketIdCache = new Map<string, string | null>();

/**
 * Looks up our internal market ID.
 *
 * The Data API trade conditionId differs from the Gamma API conditionId
 * (market-level vs event-level hash). So we match by title first
 * (most reliable), then fall back to conditionId.
 */
async function getMarketId(conditionId: string, title?: string): Promise<string | null> {
  // Try title match first (most reliable)
  if (title) {
    const cacheKey = `t:${title}`;
    if (marketIdCache.has(cacheKey)) return marketIdCache.get(cacheKey)!;

    const result = await db.query(
      `SELECT id FROM markets WHERE platform = 'polymarket' AND title = $1 LIMIT 1`,
      [title]
    );
    const id = result.rows[0]?.id || null;
    marketIdCache.set(cacheKey, id);
    if (id) return id;
  }

  // Fall back to conditionId match
  const cacheKey = `c:${conditionId}`;
  if (marketIdCache.has(cacheKey)) return marketIdCache.get(cacheKey)!;

  const result = await db.query(
    `SELECT id FROM markets WHERE platform = 'polymarket' AND platform_id = $1`,
    [conditionId]
  );
  const id = result.rows[0]?.id || null;
  marketIdCache.set(cacheKey, id);
  return id;
}

/**
 * Looks up our internal wallet ID by address.
 */
async function getWalletId(address: string): Promise<string | null> {
  const result = await db.query(
    'SELECT id FROM wallets WHERE address = $1',
    [address.toLowerCase()]
  );
  return result.rows[0]?.id || null;
}

/**
 * Inserts a trade into our database if it doesn't already exist.
 * Returns true if inserted, false if duplicate.
 */
async function insertTrade(trade: any, walletAddress: string): Promise<boolean> {
  const txHash = trade.transactionHash || null;

  const size = typeof trade.size === 'number' ? trade.size : parseFloat(trade.size || '0');
  const price = typeof trade.price === 'number' ? trade.price : parseFloat(trade.price || '0');
  const outcome = trade.outcomeIndex === 0 ? 'YES' : 'NO';
  const isWhale = size >= env.WHALE_THRESHOLD;

  const marketId = trade.conditionId ? await getMarketId(trade.conditionId, trade.title) : null;
  const walletId = await getWalletId(walletAddress);

  try {
    await db.query(
      `INSERT INTO trades (
        platform, market_id, wallet_id, wallet_address,
        side, outcome, price, size, token_amount, tx_hash,
        is_whale, platform_timestamp
      ) VALUES (
        'polymarket', $1, $2, $3,
        $4, $5, $6, $7, $8, $9,
        $10, to_timestamp($11)
      )
      ON CONFLICT (tx_hash) WHERE tx_hash IS NOT NULL DO UPDATE SET
        market_id = COALESCE(EXCLUDED.market_id, trades.market_id),
        wallet_id = COALESCE(EXCLUDED.wallet_id, trades.wallet_id)`,
      [
        marketId,
        walletId,
        walletAddress.toLowerCase(),
        trade.side || 'BUY',
        outcome,
        price,
        size,
        null, // token_amount
        txHash,
        isWhale,
        trade.timestamp || Date.now() / 1000,
      ]
    );
    return true;
  } catch {
    // Skip other constraint violations
    return false;
  }
}

/**
 * Main enrichment function — called by BullMQ every 5 minutes.
 *
 * Cycles through ALL wallets, not just top by volume.
 * Each run picks 20 wallets that haven't been enriched in 24h.
 * Orders by PnL DESC so highest-value wallets get enriched first.
 */
export async function enrichWalletTrades(): Promise<void> {
  log.info('Starting wallet trade enrichment...');
  const startTime = Date.now();

  try {
    // Get ALL wallets with volume or PnL, ordered by PnL DESC
    // We fetch more than BATCH_SIZE to account for already-enriched ones
    const walletsResult = await db.query(
      `SELECT address, total_volume, total_pnl
       FROM wallets
       WHERE total_volume > 0 OR total_pnl > 0
       ORDER BY COALESCE(total_pnl, 0) DESC`
    );

    let enrichedCount = 0;
    let totalNewTrades = 0;
    let skippedCount = 0;

    for (const wallet of walletsResult.rows) {
      if (enrichedCount >= ENRICHMENT_CONFIG.BATCH_SIZE) break;

      const address = wallet.address;

      // Check if already enriched (Redis TTL)
      const alreadyEnriched = await redis.get(REDIS_KEYS.walletEnriched(address));
      if (alreadyEnriched) {
        skippedCount++;
        continue;
      }

      log.debug({ address, volume: wallet.total_volume }, 'Enriching wallet');

      // Fetch trade history from API
      const trades = await fetchWalletTrades(address);

      let newTrades = 0;
      for (const trade of trades) {
        const inserted = await insertTrade(trade, address);
        if (inserted) newTrades++;
      }

      totalNewTrades += newTrades;

      // Mark as enriched with 24h TTL
      await redis.set(
        REDIS_KEYS.walletEnriched(address),
        '1',
        'EX',
        ENRICHMENT_CONFIG.ENRICHMENT_TTL_SECONDS
      );

      enrichedCount++;

      log.debug(
        { address, fetched: trades.length, newTrades },
        'Wallet enriched'
      );

      // Rate limit between wallets
      await new Promise((resolve) => setTimeout(resolve, ENRICHMENT_CONFIG.RATE_LIMIT_DELAY_MS));
    }

    const duration = Date.now() - startTime;
    log.info(
      { walletsEnriched: enrichedCount, skipped: skippedCount, newTrades: totalNewTrades, durationMs: duration },
      'Wallet trade enrichment complete'
    );
  } catch (err) {
    log.error({ err }, 'Wallet trade enrichment failed');
    throw err;
  }
}
