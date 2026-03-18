// =============================================================
// Trades Route — /api/trades
// =============================================================
//
// GET /api/trades
//   Recent trades feed — the live whale activity feed for the
//   dashboard. Powers the "recent whale trades" table.
//
//   Query params:
//     whale_only  — 'true' | 'false' (default false)
//                   If true, only trades where is_whale = true
//     platform    — 'polymarket' | 'kalshi' (optional)
//     market_id   — filter to a specific market (optional)
//     limit       — results per page (default 50, max 100)
//     offset      — pagination offset (default 0)
//
//   Response includes wallet pseudonym + market title for display.
// =============================================================

import { Hono } from 'hono';
import { db } from '../db/postgres';
import { createLogger } from '../utils/logger';

export const tradesRouter = new Hono();
const log = createLogger('routes:trades');

// =============================================================
// GET /api/trades
// =============================================================
tradesRouter.get('/', async (c) => {
  try {
    const query = c.req.query();

    const whaleOnly = query.whale_only === 'true';
    const platform = query.platform || null;
    const marketId = query.market_id || null;
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    // Build WHERE conditions
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (whaleOnly) {
      conditions.push(`t.is_whale = true`);
    }

    // Exclude chain-indexer trades with UNKNOWN outcome and no market link
    // These are raw on-chain events without context — useless for display
    conditions.push(`t.outcome != 'UNKNOWN'`);
    conditions.push(`t.market_id IS NOT NULL`);
    if (platform) {
      conditions.push(`t.platform = $${paramIndex++}`);
      params.push(platform);
    }
    if (marketId) {
      conditions.push(`t.market_id = $${paramIndex++}`);
      params.push(marketId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM trades t ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Trades with wallet + market context
    const tradesResult = await db.query(
      `SELECT
        t.id, t.platform, t.side, t.outcome, t.price, t.size,
        t.is_whale, t.platform_timestamp, t.wallet_address, t.tx_hash,
        COALESCE(w.pseudonym, t.wallet_address) AS wallet_pseudonym,
        w.tags AS wallet_tags,
        w.id AS wallet_id,
        m.id AS market_id,
        m.title AS market_title,
        m.category AS market_category,
        m.safety_score AS market_safety_score
       FROM trades t
       LEFT JOIN wallets w ON t.wallet_id = w.id
       LEFT JOIN markets m ON t.market_id = m.id
       ${whereClause}
       ORDER BY t.platform_timestamp DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    return c.json({
      data: { trades: tradesResult.rows, total, limit, offset },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/trades failed');
    return c.json({ data: null, error: 'Failed to fetch trades' }, 500);
  }
});
