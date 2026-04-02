// =============================================================
// Markets Routes — /api/markets
// =============================================================
//
// GET /api/markets
//   List markets with filters + pagination.
//   Query params:
//     platform         — 'polymarket' | 'kalshi'
//     category         — 'politics' | 'sports' | etc.
//     status           — 'active' | 'closed' | 'resolved'
//     min_safety_score — minimum safety score (0-100)
//     near_resolution  — '24h' | '48h' | '7d' | '30d' — show endgame/bonding markets
//     min_probability  — 0.80-0.99 (default 0.90) — min dominant side probability
//     sort             — 'volume' | 'safety_score' | 'yes_price' | 'liquidity' | 'end_date'
//     limit            — results per page (default 50, max 200)
//     offset           — pagination offset (default 0)
//   Cached in Redis for 60s per unique param combo.
//
// GET /api/markets/:id
//   Single market detail.
//   Includes: safety_details, smart money consensus from Redis,
//   matched market on other platform if exists.
//
// GET /api/markets/:id/trades
//   Recent trades in a specific market.
//   Query params: limit (default 20, max 100), offset
// =============================================================

import { Hono } from 'hono';
import { db } from '../db/postgres';
import { redis } from '../db/redis';
import { createLogger } from '../utils/logger';

export const marketsRouter = new Hono();
const log = createLogger('routes:markets');

// Cache TTL for market list queries (60 seconds)
const LIST_CACHE_TTL = 60;

// =============================================================
// GET /api/markets
// =============================================================
marketsRouter.get('/', async (c) => {
  try {
    const query = c.req.query();

    // Parse and validate query params
    const platform = query.platform || null;
    const category = query.category || null;
    const status = query.status || 'active';
    const minSafetyScore = query.min_safety_score ? parseInt(query.min_safety_score, 10) : null;
    const sort = query.sort || 'volume';
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const offset = parseInt(query.offset || '0', 10);

    // Near Resolution filter: markets with high probability expiring within N hours
    const nearResolution = query.near_resolution || null;
    const validWindows: Record<string, number> = { '24h': 24, '48h': 48, '7d': 168, '30d': 720 };
    const nearResolutionHours = nearResolution && validWindows[nearResolution] ? validWindows[nearResolution] : null;

    // Validate sort column to prevent SQL injection
    const validSorts = ['volume', 'safety_score', 'yes_price', 'liquidity', 'created_at', 'end_date'];
    const sortCol = validSorts.includes(sort) ? sort : 'volume';

    // Build Redis cache key from params
    const minProbParam = query.min_probability || '';
    const cacheKey = `cache:api:markets:${platform}:${category}:${status}:${minSafetyScore}:${nearResolution}:${minProbParam}:${sortCol}:${limit}:${offset}`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return c.json(JSON.parse(cached));
    }

    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (platform) {
      conditions.push(`platform = $${paramIndex++}`);
      params.push(platform);
    }
    if (category) {
      conditions.push(`category = $${paramIndex++}`);
      params.push(category);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (minSafetyScore !== null && !isNaN(minSafetyScore)) {
      conditions.push(`safety_score >= $${paramIndex++}`);
      params.push(minSafetyScore);
    }

    // Near Resolution / Bonding / Endgame filter
    // Based on real strategies: UnifAI (>95%), bonding (>80%), endgame sweep (>95%)
    if (nearResolutionHours !== null) {
      // Market must expire in the future but within the chosen window
      conditions.push(`end_date > NOW()`);
      conditions.push(`end_date <= NOW() + INTERVAL '${nearResolutionHours} hours'`);
      // Either YES or NO price must show high probability (dominant outcome)
      const minProb = query.min_probability ? parseFloat(query.min_probability) : 0.90;
      const clampedProb = Math.max(0.80, Math.min(0.99, minProb));
      conditions.push(`GREATEST(COALESCE(yes_price, 0), COALESCE(no_price, 0)) >= $${paramIndex++}`);
      params.push(clampedProb);
      // Require minimum liquidity to avoid failed fills (endgame risk)
      conditions.push(`COALESCE(liquidity, 0) >= 5000`);
    }

    // Always filter out markets with null title
    conditions.push(`title IS NOT NULL`);


    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM markets ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // When near_resolution is active, add computed columns for estimated return
    const nearResFields = nearResolutionHours !== null
      ? `,
        GREATEST(COALESCE(yes_price, 0), COALESCE(no_price, 0)) AS dominant_price,
        CASE WHEN COALESCE(yes_price, 0) >= COALESCE(no_price, 0) THEN 'YES' ELSE 'NO' END AS dominant_outcome,
        ROUND((1.0 - GREATEST(COALESCE(yes_price, 0), COALESCE(no_price, 0))) * 100, 2) AS est_return_pct,
        EXTRACT(EPOCH FROM (end_date - NOW())) / 3600 AS hours_until_expiry`
      : '';

    // Default sort for near_resolution: soonest expiry first (best for endgame)
    const effectiveSort = nearResolutionHours !== null && sort === 'volume' ? 'end_date' : sortCol;
    const sortDirection = effectiveSort === 'end_date' ? 'ASC' : 'DESC';

    // Get paginated results
    const marketsResult = await db.query(
      `SELECT
        id, platform, platform_id, title, category, status,
        yes_price, no_price, volume, liquidity,
        safety_score, safety_details,
        outcome, end_date, matched_market_id,
        token_ids, created_at, updated_at
        ${nearResFields}
       FROM markets
       ${whereClause}
       ORDER BY ${effectiveSort} ${sortDirection} NULLS LAST
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    const response = {
      data: {
        markets: marketsResult.rows,
        total,
        limit,
        offset,
      },
      error: null,
    };

    // Cache for 60 seconds
    await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response));

    return c.json(response);
  } catch (err) {
    log.error({ err }, 'GET /api/markets failed');
    return c.json({ data: null, error: 'Failed to fetch markets' }, 500);
  }
});

// =============================================================
// GET /api/markets/:id
// =============================================================
marketsRouter.get('/:id', async (c) => {
  try {
    const { id } = c.req.param();

    // Fetch market from DB
    const marketResult = await db.query(
      `SELECT
        id, platform, platform_id, title, description, category, status,
        yes_price, no_price, volume, liquidity,
        safety_score, safety_details,
        outcome, resolution_source, end_date, matched_market_id,
        token_ids, created_at, updated_at
       FROM markets WHERE id = $1`,
      [id]
    );

    if (marketResult.rows.length === 0) {
      return c.json({ data: null, error: 'Market not found' }, 404);
    }

    const market = marketResult.rows[0];

    // Fetch smart money consensus from Redis (set by consensus.ts every 2 min)
    let consensus = null;
    const consensusRaw = await redis.get(`consensus:market:${id}`);
    if (consensusRaw) {
      consensus = JSON.parse(consensusRaw);
    }

    // Fetch matched market on the other platform if linked
    let matchedMarket = null;
    if (market.matched_market_id) {
      const matchedResult = await db.query(
        `SELECT id, platform, title, yes_price, no_price, volume, safety_score
         FROM markets WHERE id = $1`,
        [market.matched_market_id]
      );
      if (matchedResult.rows.length > 0) {
        matchedMarket = matchedResult.rows[0];
      }
    }

    return c.json({
      data: { market, consensus, matched_market: matchedMarket },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/markets/:id failed');
    return c.json({ data: null, error: 'Failed to fetch market' }, 500);
  }
});

// =============================================================
// GET /api/markets/:id/trades
// =============================================================
marketsRouter.get('/:id/trades', async (c) => {
  try {
    const { id } = c.req.param();
    const query = c.req.query();
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    // Verify market exists
    const marketCheck = await db.query(
      'SELECT id FROM markets WHERE id = $1',
      [id]
    );
    if (marketCheck.rows.length === 0) {
      return c.json({ data: null, error: 'Market not found' }, 404);
    }

    // Get trades with wallet pseudonym
    const tradesResult = await db.query(
      `SELECT
        t.id, t.platform, t.side, t.outcome, t.price, t.size,
        t.is_whale, t.platform_timestamp,
        t.wallet_address,
        COALESCE(w.pseudonym, t.wallet_address) AS wallet_pseudonym,
        w.tags AS wallet_tags
       FROM trades t
       LEFT JOIN wallets w ON t.wallet_id = w.id
       WHERE t.market_id = $1 AND t.outcome != 'UNKNOWN'
       ORDER BY t.platform_timestamp DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM trades WHERE market_id = $1 AND outcome != 'UNKNOWN'`,
      [id]
    );
    const total = parseInt(countResult.rows[0].total, 10);

    return c.json({
      data: { trades: tradesResult.rows, total, limit, offset },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/markets/:id/trades failed');
    return c.json({ data: null, error: 'Failed to fetch market trades' }, 500);
  }
});
