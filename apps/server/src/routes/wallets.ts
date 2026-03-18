// =============================================================
// Wallets Routes — /api/wallets
// =============================================================
//
// GET /api/wallets
//   Smart money leaderboard — join wallets + wallet_scores.
//   Query params:
//     period  — '7d' | '30d' | '90d' | 'all' (default: '30d')
//     sort    — 'smart_score' | 'volume' | 'roi' | 'pnl' (default: 'smart_score')
//     limit   — results per page (default 50, max 200)
//     offset  — pagination offset (default 0)
//   Cached 60s in Redis.
//
// GET /api/wallets/:address
//   Full wallet profile.
//   Looks up by proxy_address (what Polymarket uses in trades)
//   or address. Returns all 4 period scores in one response.
//
// GET /api/wallets/:address/positions
//   Current open positions (size > 0) for this wallet.
//   Includes market title + current prices for PnL display.
//
// GET /api/wallets/:address/trades
//   Paginated trade history for this wallet.
//   Query params: limit, offset, market_id (filter to one market)
// =============================================================

import { Hono } from 'hono';
import { db } from '../db/postgres';
import { redis } from '../db/redis';
import { createLogger } from '../utils/logger';

export const walletsRouter = new Hono();
const log = createLogger('routes:wallets');

const LIST_CACHE_TTL = 60;

// =============================================================
// GET /api/wallets — leaderboard
// =============================================================
walletsRouter.get('/', async (c) => {
  try {
    const query = c.req.query();

    const period = ['7d', '30d', '90d', 'all'].includes(query.period || '')
      ? query.period
      : '30d';
    const validSorts: Record<string, string> = {
      smart_score: 'ws.smart_score',
      volume: 'ws.total_volume',
      roi: 'ws.roi',
      pnl: 'ws.total_pnl',
    };
    const sortCol = validSorts[query.sort || ''] || 'ws.smart_score';
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const offset = parseInt(query.offset || '0', 10);

    const cacheKey = `cache:api:wallets:${period}:${query.sort}:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return c.json(JSON.parse(cached));
    }

    // COUNT for pagination
    const countResult = await db.query(
      `SELECT COUNT(*) AS total
       FROM wallets w
       JOIN wallet_scores ws ON ws.wallet_id = w.id
       WHERE ws.period = $1
         AND ws.total_markets > 0`,
      [period]
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Leaderboard query — join wallets + wallet_scores for a given period
    const walletsResult = await db.query(
      `SELECT
        w.id, w.address, w.pseudonym, w.profile_image, w.x_username,
        w.is_verified, w.tags, w.leaderboard_rank,
        ws.smart_score, ws.total_pnl, ws.total_volume,
        ws.win_rate, ws.roi, ws.sharpe_ratio,
        ws.total_markets, ws.winning_markets,
        ws.win_rate_score, ws.roi_score, ws.consistency_score, ws.volume_score,
        ws.data_quality,
        ws.category_expertise, ws.calculated_at
       FROM wallets w
       JOIN wallet_scores ws ON ws.wallet_id = w.id
       WHERE ws.period = $1
         AND ws.total_markets > 0
       ORDER BY ${sortCol} DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [period, limit, offset]
    );

    const response = {
      data: { wallets: walletsResult.rows, total, limit, offset, period },
      error: null,
    };

    await redis.setex(cacheKey, LIST_CACHE_TTL, JSON.stringify(response));

    return c.json(response);
  } catch (err) {
    log.error({ err }, 'GET /api/wallets failed');
    return c.json({ data: null, error: 'Failed to fetch wallets' }, 500);
  }
});

// =============================================================
// GET /api/wallets/:address — wallet profile
// =============================================================
walletsRouter.get('/:address', async (c) => {
  try {
    const { address } = c.req.param();

    // Lookup by proxy_address (Polymarket uses this in trade data) OR address
    const walletResult = await db.query(
      `SELECT
        id, address, proxy_address, pseudonym, profile_image,
        x_username, is_verified, tags, leaderboard_rank,
        total_volume, total_pnl, first_seen, last_active, created_at
       FROM wallets
       WHERE address = $1 OR proxy_address = $1
       LIMIT 1`,
      [address.toLowerCase()]
    );

    if (walletResult.rows.length === 0) {
      return c.json({ data: null, error: 'Wallet not found' }, 404);
    }

    const wallet = walletResult.rows[0];

    // Fetch all 4 period scores in one query (including breakdown columns)
    const scoresResult = await db.query(
      `SELECT
        period, smart_score, total_pnl, total_volume,
        win_rate, roi, sharpe_ratio,
        total_markets, winning_markets,
        avg_position_size, category_expertise, calculated_at,
        win_rate_score, roi_score, consistency_score, volume_score, data_quality
       FROM wallet_scores
       WHERE wallet_id = $1`,
      [wallet.id]
    );

    // Convert rows into { '7d': {...}, '30d': {...}, '90d': {...}, 'all': {...} }
    const scores: Record<string, any> = {};
    for (const row of scoresResult.rows) {
      scores[row.period] = row;
    }

    return c.json({
      data: { wallet, scores },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/wallets/:address failed');
    return c.json({ data: null, error: 'Failed to fetch wallet' }, 500);
  }
});

// =============================================================
// GET /api/wallets/:address/positions
// =============================================================
walletsRouter.get('/:address/positions', async (c) => {
  try {
    const { address } = c.req.param();

    // Resolve wallet ID
    const walletResult = await db.query(
      `SELECT id FROM wallets WHERE address = $1 OR proxy_address = $1 LIMIT 1`,
      [address.toLowerCase()]
    );

    if (walletResult.rows.length === 0) {
      return c.json({ data: null, error: 'Wallet not found' }, 404);
    }

    const walletId = walletResult.rows[0].id;

    // Fetch open positions joined with market data
    const positionsResult = await db.query(
      `SELECT
        p.id, p.outcome, p.size, p.avg_price,
        p.initial_value, p.current_value,
        p.unrealized_pnl, p.unrealized_pnl_pct, p.realized_pnl,
        p.updated_at,
        m.id AS market_id, m.title AS market_title,
        m.platform, m.category, m.status,
        m.yes_price, m.no_price, m.end_date,
        m.safety_score
       FROM positions p
       JOIN markets m ON p.market_id = m.id
       WHERE p.wallet_id = $1
         AND p.size > 0
       ORDER BY p.current_value DESC NULLS LAST`,
      [walletId]
    );

    return c.json({
      data: {
        positions: positionsResult.rows,
        total: positionsResult.rows.length,
      },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/wallets/:address/positions failed');
    return c.json({ data: null, error: 'Failed to fetch positions' }, 500);
  }
});

// =============================================================
// GET /api/wallets/:address/trades
// =============================================================
walletsRouter.get('/:address/trades', async (c) => {
  try {
    const { address } = c.req.param();
    const query = c.req.query();

    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const offset = parseInt(query.offset || '0', 10);
    const marketIdFilter = query.market_id || null;

    // Resolve wallet ID
    const walletResult = await db.query(
      `SELECT id FROM wallets WHERE address = $1 OR proxy_address = $1 LIMIT 1`,
      [address.toLowerCase()]
    );

    if (walletResult.rows.length === 0) {
      return c.json({ data: null, error: 'Wallet not found' }, 404);
    }

    const walletId = walletResult.rows[0].id;

    const conditions = [`t.wallet_id = $1`];
    const params: any[] = [walletId];
    let paramIndex = 2;

    if (marketIdFilter) {
      conditions.push(`t.market_id = $${paramIndex++}`);
      params.push(marketIdFilter);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM trades t ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const tradesResult = await db.query(
      `SELECT
        t.id, t.platform, t.side, t.outcome, t.price, t.size,
        t.is_whale, t.platform_timestamp, t.tx_hash,
        m.id AS market_id, m.title AS market_title,
        m.category, m.yes_price, m.no_price
       FROM trades t
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
    log.error({ err }, 'GET /api/wallets/:address/trades failed');
    return c.json({ data: null, error: 'Failed to fetch wallet trades' }, 500);
  }
});
