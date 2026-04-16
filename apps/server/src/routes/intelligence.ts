// =============================================================
// Intelligence Routes — /api/intelligence
// =============================================================
//
// GET /api/intelligence/consensus/:marketId
//   Smart money consensus for a market.
//   Read directly from Redis (set by consensus.ts every 2 min).
//   Returns null gracefully if not yet calculated.
//
// GET /api/intelligence/arbitrage
//   Active cross-platform arbitrage opportunities.
//   Reads from arbitrage_opportunities table.
//   Only returns non-expired opportunities.
//
// GET /api/intelligence/smart-money
//   List of wallets tagged as smart money (score >= 60).
//   Quick endpoint for populating "smart money" filter in UI.
// =============================================================

import { Hono } from 'hono';
import { db } from '../db/postgres';
import { redis } from '../db/redis';
import { createLogger } from '../utils/logger';

export const intelligenceRouter = new Hono();
const log = createLogger('routes:intelligence');

// =============================================================
// GET /api/intelligence/consensus/:marketId
// =============================================================
intelligenceRouter.get('/consensus/:marketId', async (c) => {
  try {
    const { marketId } = c.req.param();

    // Verify market exists first
    const marketCheck = await db.query(
      'SELECT id, title, yes_price, no_price FROM markets WHERE id = $1',
      [marketId]
    );

    if (marketCheck.rows.length === 0) {
      return c.json({ data: null, error: 'Market not found' }, 404);
    }

    // Read consensus from Redis (consensus.ts writes here every 2 min)
    const consensusRaw = await redis.get(`consensus:market:${marketId}`);
    const consensus = consensusRaw ? JSON.parse(consensusRaw) : null;

    return c.json({
      data: {
        market_id: marketId,
        market_title: marketCheck.rows[0].title,
        current_yes_price: parseFloat(marketCheck.rows[0].yes_price) || null,
        current_no_price: parseFloat(marketCheck.rows[0].no_price) || null,
        consensus,
      },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/intelligence/consensus/:marketId failed');
    return c.json({ data: null, error: 'Failed to fetch consensus' }, 500);
  }
});

// =============================================================
// GET /api/intelligence/arbitrage
// =============================================================
intelligenceRouter.get('/arbitrage', async (c) => {
  try {
    const query = c.req.query();
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const minSpread = parseFloat(query.min_spread || '0');

    // Get active (non-expired) arbitrage opportunities with market details
    const result = await db.query(
      `SELECT
        ao.id, ao.spread, ao.spread_pct, ao.detected_at, ao.expired_at,
        ma.id AS market_a_id, ma.title AS market_a_title,
        ma.platform AS market_a_platform,
        ma.yes_price AS market_a_yes_price, ma.no_price AS market_a_no_price,
        mb.id AS market_b_id, mb.title AS market_b_title,
        mb.platform AS market_b_platform,
        mb.yes_price AS market_b_yes_price, mb.no_price AS market_b_no_price
       FROM arbitrage_opportunities ao
       JOIN markets ma ON ao.market_a_id = ma.id
       JOIN markets mb ON ao.market_b_id = mb.id
       WHERE (ao.expired_at IS NULL OR ao.expired_at > NOW())
         AND ao.spread_pct >= $1
       ORDER BY ao.spread_pct DESC
       LIMIT $2`,
      [minSpread, limit]
    );

    return c.json({
      data: {
        opportunities: result.rows,
        count: result.rows.length,
      },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/intelligence/arbitrage failed');
    return c.json({ data: null, error: 'Failed to fetch arbitrage opportunities' }, 500);
  }
});

// =============================================================
// GET /api/intelligence/smart-money
//   Quick list of smart money wallets (score >= 60, period 30d)
//   Used by frontend to populate smart money filter chips.
// =============================================================
intelligenceRouter.get('/smart-money', async (c) => {
  try {
    const query = c.req.query();
    const period = ['7d', '30d', '90d', 'all'].includes(query.period || '')
      ? query.period
      : '30d';
    const minScore = parseInt(query.min_score || '60', 10);
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);

    const result = await db.query(
      `SELECT
        w.id, w.address, w.pseudonym, w.profile_image, w.x_username,
        w.is_verified, w.tags, w.leaderboard_rank,
        ws.smart_score, ws.total_pnl, ws.total_volume, ws.roi, ws.win_rate
       FROM wallets w
       JOIN wallet_scores ws ON ws.wallet_id = w.id
       WHERE ws.period = $1
         AND ws.smart_score >= $2
       ORDER BY ws.smart_score DESC
       LIMIT $3`,
      [period, minScore, limit]
    );

    return c.json({
      data: {
        wallets: result.rows,
        count: result.rows.length,
        period,
        min_score: minScore,
      },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/intelligence/smart-money failed');
    return c.json({ data: null, error: 'Failed to fetch smart money wallets' }, 500);
  }
});

// =============================================================
// GET /api/intelligence/stats
// Aggregate stats for the dashboard hero bar.
// Cached in Redis for 60s.
// =============================================================
intelligenceRouter.get('/stats', async (c) => {
  try {
    const cacheKey = 'cache:stats:hero';
    const cached = await redis.get(cacheKey);
    if (cached) {
      return c.json(JSON.parse(cached));
    }

    const [markets, wallets, trades, whaleTrades24h, volume24h] = await Promise.all([
      db.query(`SELECT COUNT(*) AS total FROM markets WHERE status = 'active'`),
      db.query(`SELECT COUNT(*) AS total FROM wallets`),
      db.query(`SELECT COUNT(*) AS total FROM trades WHERE platform_timestamp > NOW() - INTERVAL '24 hours'`),
      db.query(`SELECT COUNT(*) AS total FROM trades WHERE is_whale = true AND platform_timestamp > NOW() - INTERVAL '24 hours'`),
      db.query(`SELECT COALESCE(SUM(size), 0) AS total FROM trades WHERE platform_timestamp > NOW() - INTERVAL '24 hours'`),
    ]);

    const response = {
      data: {
        active_markets: parseInt(markets.rows[0].total, 10),
        tracked_wallets: parseInt(wallets.rows[0].total, 10),
        trades_24h: parseInt(trades.rows[0].total, 10),
        whale_trades_24h: parseInt(whaleTrades24h.rows[0].total, 10),
        volume_24h: parseFloat(volume24h.rows[0].total) || 0,
      },
      error: null,
    };

    await redis.setex(cacheKey, 60, JSON.stringify(response));
    return c.json(response);
  } catch (err) {
    log.error({ err }, 'GET /api/intelligence/stats failed');
    return c.json({ data: null, error: 'Failed to fetch stats' }, 500);
  }
});
