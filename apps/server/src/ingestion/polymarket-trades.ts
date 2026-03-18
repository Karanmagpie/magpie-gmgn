// =============================================================
// Polymarket Trade Ingestion (Data API)
// =============================================================
//
// WHAT: Fetches recent trades from Polymarket and stores them
//       in our database. Flags whale trades (>$10K).
//
// WHY:  Trades are the raw data for EVERYTHING:
//       - Whale feed ("0x7f3a bought $45K YES on Fed cuts")
//       - Smart Score calculation (win rate, ROI based on trades)
//       - Position tracking (trades update positions)
//       - Copy trading (detect whale trade → copy it)
//
// API:  Polymarket Data API (https://data-api.polymarket.com)
//       GET /trades — Returns recent trades with pagination
//       No authentication required.
//
// HOW:  Runs every 1 minute via BullMQ.
//       1. Fetch trades since last sync timestamp
//       2. For each trade: insert into our trades table
//       3. If trade size > $10K: flag as whale, push to Redis feed
//       4. Link trade to known wallet (if we track that wallet)
//
// WHALE DETECTION:
//       A trade is flagged as "whale" if size > WHALE_THRESHOLD ($10K).
//       Whale trades are pushed to Redis list "feed:whale_trades"
//       which powers the real-time whale feed on the dashboard.
//
// DOCS: https://docs.polymarket.com/#get-trades
// =============================================================

import { db } from '../db/postgres';
import { redis } from '../db/redis';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';
import { REDIS_KEYS, TRADE_SIZE_TIERS } from '@markypie/shared';

const log = createLogger('polymarket-trades');

// Track the timestamp of the last trade we processed
// so we only fetch new trades on each sync cycle.
// Start from 10 min ago on startup to catch recent activity.
// Cloudflare caches API responses for ~5 min, so 10 min window
// ensures we don't miss trades at the cache boundary.
let lastSyncTimestamp: number = Date.now() - 10 * 60 * 1000;

/**
 * Fetches recent trades from Polymarket Data API.
 *
 * The API returns a flat JSON array (no wrapper object), sorted by
 * timestamp descending. Pagination is via `offset` query param.
 *
 * Actual API response shape (camelCase):
 * [
 *   {
 *     proxyWallet: "0x64ee...",     // trader's proxy wallet on Polygon
 *     side: "BUY",                  // "BUY" | "SELL"
 *     asset: "4633885...",          // ERC-1155 token ID (big number)
 *     conditionId: "0x77653...",    // market condition ID
 *     size: 10,                     // trade size in USD (number, not string!)
 *     price: 0.999,                 // price paid (number, not string!)
 *     timestamp: 1771571622,        // Unix seconds
 *     title: "Nuggets vs. Clippers",// market title (included for free!)
 *     outcome: "Clippers",          // could be "Yes", "No", "Up", "Down", team name, etc.
 *     outcomeIndex: 1,              // 0 = first outcome, 1 = second outcome
 *     transactionHash: "0x308b...", // Polygon tx hash
 *     name: "PHD123",              // trader username
 *     pseudonym: "Uneven-Closet",  // trader display name
 *   }
 * ]
 */
async function fetchRecentTrades(): Promise<any[]> {
  const allTrades: any[] = [];
  let offset = 0;

  // Fetch up to 500 trades per sync cycle
  const maxTrades = 500;

  while (allTrades.length < maxTrades) {
    const url = `${env.POLYMARKET_DATA_API}/trades?limit=100&offset=${offset}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Data API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const trades = Array.isArray(data) ? data : data.data || [];

    if (trades.length === 0) break;

    // Filter to trades newer than our last sync
    const newTrades = trades.filter(
      (t: any) => (t.timestamp * 1000) > lastSyncTimestamp
    );

    if (newTrades.length === 0) break; // All trades are older than last sync

    allTrades.push(...newTrades);
    offset += trades.length;
  }

  return allTrades;
}

/**
 * Looks up our internal market ID by Polymarket's condition_id.
 * Returns null if we haven't synced this market yet.
 */
async function getMarketId(conditionId: string): Promise<string | null> {
  const result = await db.query(
    'SELECT id FROM markets WHERE platform = $1 AND platform_id = $2',
    ['polymarket', conditionId]
  );
  return result.rows[0]?.id || null;
}

/**
 * Looks up our internal wallet ID by address.
 * Returns null if we don't track this wallet.
 */
async function getWalletId(address: string): Promise<string | null> {
  const result = await db.query(
    'SELECT id FROM wallets WHERE address = $1',
    [address.toLowerCase()]
  );
  return result.rows[0]?.id || null;
}

/**
 * Pushes a whale trade to the Redis live feed.
 *
 * Redis List "feed:whale_trades":
 * - LPUSH adds to the front (newest first)
 * - LTRIM keeps only the last 100 entries (bounded memory)
 *
 * This is what powers the real-time whale feed on the dashboard.
 * When a user opens the dashboard, we read this list from Redis
 * (instant, no database query needed).
 */
async function pushToWhaleFeed(trade: {
  wallet_address: string;
  side: string;
  outcome: string;
  price: number;
  size: number;
  market_title: string;
  market_id: string | null;
  timestamp: number;
  tier?: string; // 'notable' | 'whale' | 'mega' | 'ultra'
}): Promise<void> {
  const feedEntry = JSON.stringify({
    ...trade,
    pushed_at: Date.now(),
  });

  // LPUSH: add to front of list
  // LTRIM: keep only first 100 entries (removes old ones)
  await redis.lpush(REDIS_KEYS.whaleFeed, feedEntry);
  await redis.ltrim(REDIS_KEYS.whaleFeed, 0, 99);

  log.info(
    { wallet: trade.wallet_address, size: trade.size, market: trade.market_title },
    'Whale trade detected and pushed to feed'
  );
}

/**
 * Main trade ingestion function — called by BullMQ every 1 minute.
 *
 * Flow:
 * 1. Fetch recent trades from Data API (since last sync)
 * 2. For each trade:
 *    a. Look up our internal market_id and wallet_id
 *    b. Insert into trades table
 *    c. If size > $10K: flag as whale, push to Redis feed
 * 3. Update lastSyncTimestamp
 */
export async function ingestPolymarketTrades(): Promise<void> {
  log.info('Starting Polymarket trade ingestion...');
  const startTime = Date.now();

  try {
    const trades = await fetchRecentTrades();

    let insertedCount = 0;
    let whaleCount = 0;

    for (const trade of trades) {
      // API field: proxyWallet (the trader's Polymarket proxy wallet on Polygon)
      const traderAddress = (trade.proxyWallet || '').toLowerCase();
      // API fields: size and price are already numbers (not strings)
      const size = typeof trade.size === 'number' ? trade.size : parseFloat(trade.size || '0');
      const price = typeof trade.price === 'number' ? trade.price : parseFloat(trade.price || '0');

      // API field: outcome can be "Yes", "No", "Up", "Down", team names, etc.
      // outcomeIndex: 0 = first outcome (typically YES), 1 = second outcome (typically NO)
      // We normalize to YES/NO based on outcomeIndex for our unified schema
      const outcome = trade.outcomeIndex === 0 ? 'YES' : 'NO';

      // Multi-tier whale classification based on real Polymarket data:
      // Notable ($5K+): top ~3-5% of trades
      // Whale ($10K+): industry standard (PolyTrack, Polywhaler)
      // Mega ($50K+): very rare, extremely high signal
      // Ultra ($100K+): handful per day, institutional level
      const isWhale = size >= env.WHALE_THRESHOLD;
      const whaleTier = size >= TRADE_SIZE_TIERS.ULTRA_WHALE ? 'ultra'
        : size >= TRADE_SIZE_TIERS.MEGA_WHALE ? 'mega'
        : size >= TRADE_SIZE_TIERS.WHALE ? 'whale'
        : size >= TRADE_SIZE_TIERS.NOTABLE ? 'notable'
        : null;

      // API field: conditionId (the market's condition hash, same as platform_id in our markets table)
      const marketId = trade.conditionId ? await getMarketId(trade.conditionId) : null;
      const walletId = traderAddress ? await getWalletId(traderAddress) : null;

      // API field: title (included in trade response — no extra DB query needed!)
      const marketTitle = trade.title || '';

      // Insert trade into database.
      // Use tx_hash to deduplicate: the Polymarket Data API is cached by
      // Cloudflare for ~5 minutes, so the same trades may appear in multiple
      // API responses. We skip trades we've already inserted by checking tx_hash.
      const txHash = trade.transactionHash || null;
      if (txHash) {
        const existing = await db.query(
          'SELECT id, market_id FROM trades WHERE tx_hash = $1 LIMIT 1',
          [txHash]
        );
        if (existing.rows.length > 0) {
          // Trade already exists — backfill market_id if it was null before
          if (!existing.rows[0].market_id && marketId) {
            await db.query(
              'UPDATE trades SET market_id = $1 WHERE tx_hash = $2 AND market_id IS NULL',
              [marketId, txHash]
            );
          }
          continue;
        }
      }

      const result = await db.query(
        `INSERT INTO trades (
          platform, market_id, wallet_id, wallet_address,
          side, outcome, price, size, token_amount, tx_hash,
          is_whale, platform_timestamp
        ) VALUES (
          'polymarket', $1, $2, $3,
          $4, $5, $6, $7, $8, $9,
          $10, to_timestamp($11)
        )
        RETURNING id`,
        [
          marketId,                           // $1
          walletId,                           // $2
          traderAddress || null,              // $3
          trade.side || 'BUY',               // $4
          outcome,                           // $5
          price,                             // $6
          size,                              // $7
          null,                              // $8: token_amount (not in API response)
          trade.transactionHash || null,     // $9: camelCase in API
          isWhale,                           // $10
          trade.timestamp || Date.now()/1000, // $11
        ]
      );

      if (result.rows.length > 0) {
        insertedCount++;

        // Push whale trades to the live Redis feed
        if (isWhale && whaleTier) {
          whaleCount++;
          await pushToWhaleFeed({
            wallet_address: traderAddress,
            side: trade.side || 'BUY',
            outcome,
            price,
            size,
            market_title: marketTitle,
            market_id: marketId,
            timestamp: trade.timestamp,
            tier: whaleTier, // 'notable' | 'whale' | 'mega' | 'ultra'
          });
        }
      }
    }

    // Only advance lastSyncTimestamp if we got new trades.
    // Use the newest trade's timestamp (not Date.now()) to avoid
    // skipping trades that arrived between API fetch and processing.
    if (trades.length > 0) {
      const newestTimestamp = Math.max(...trades.map((t: any) => t.timestamp || 0));
      if (newestTimestamp > 0) {
        lastSyncTimestamp = newestTimestamp * 1000; // Convert seconds → ms
      }
    }

    const duration = Date.now() - startTime;
    log.info(
      { fetched: trades.length, inserted: insertedCount, whales: whaleCount, durationMs: duration },
      'Polymarket trade ingestion complete'
    );
  } catch (err) {
    log.error({ err }, 'Polymarket trade ingestion failed');
    throw err; // BullMQ handles retry
  }
}
