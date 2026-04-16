// =============================================================
// Follows Routes — /api/follows
// =============================================================
//
// Personalized Following Feed — users (identified by connected
// wallet address) can follow specific Polymarket wallets and get
// a filtered feed of only those wallets' trades.
//
// POST   /api/follows          — follow a wallet
// DELETE /api/follows/:address — unfollow a wallet
// GET    /api/follows          — list followed wallets
// GET    /api/follows/feed     — trades from followed wallets
// =============================================================

import { Hono } from 'hono';
import { db } from '../db/postgres';
import { createLogger } from '../utils/logger';

export const followsRouter = new Hono();
const log = createLogger('routes:follows');

// =============================================================
// GET /api/follows?user_address=0x...
// List all wallets the user follows
// =============================================================
followsRouter.get('/', async (c) => {
  try {
    const userAddress = c.req.query('user_address');
    if (!userAddress) {
      return c.json({ data: null, error: 'user_address is required' }, 400);
    }

    const result = await db.query(
      `SELECT
        uf.wallet_address,
        uf.pseudonym,
        uf.created_at,
        (SELECT COUNT(*) FROM user_follows WHERE wallet_address = uf.wallet_address) AS follower_count
       FROM user_follows uf
       WHERE uf.user_address = $1
       ORDER BY uf.created_at DESC`,
      [userAddress.toLowerCase()]
    );

    return c.json({
      data: { follows: result.rows, count: result.rows.length },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/follows failed');
    return c.json({ data: null, error: 'Failed to fetch follows' }, 500);
  }
});

// =============================================================
// GET /api/follows/feed?user_address=0x...&limit=20&offset=0
// Trades from all followed wallets (the personalized feed)
// =============================================================
followsRouter.get('/feed', async (c) => {
  try {
    const userAddress = c.req.query('user_address');
    if (!userAddress) {
      return c.json({ data: null, error: 'user_address is required' }, 400);
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    // Get trades from followed wallets with market + wallet context
    const tradesResult = await db.query(
      `SELECT
        t.id, t.platform, t.side, t.outcome, t.price, t.size,
        t.is_whale, t.platform_timestamp, t.wallet_address, t.tx_hash,
        COALESCE(w.pseudonym, t.wallet_address) AS wallet_pseudonym,
        w.tags AS wallet_tags,
        m.id AS market_id,
        m.title AS market_title,
        m.category AS market_category
       FROM trades t
       INNER JOIN user_follows uf ON t.wallet_address = uf.wallet_address
         AND uf.user_address = $1
       LEFT JOIN wallets w ON t.wallet_id = w.id
       LEFT JOIN markets m ON t.market_id = m.id
       WHERE t.outcome != 'UNKNOWN' AND t.market_id IS NOT NULL
       ORDER BY t.platform_timestamp DESC
       LIMIT $2 OFFSET $3`,
      [userAddress.toLowerCase(), limit, offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) AS total
       FROM trades t
       INNER JOIN user_follows uf ON t.wallet_address = uf.wallet_address
         AND uf.user_address = $1
       WHERE t.outcome != 'UNKNOWN' AND t.market_id IS NOT NULL`,
      [userAddress.toLowerCase()]
    );
    const total = parseInt(countResult.rows[0].total, 10);

    return c.json({
      data: { trades: tradesResult.rows, total, limit, offset },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'GET /api/follows/feed failed');
    return c.json({ data: null, error: 'Failed to fetch follow feed' }, 500);
  }
});

// =============================================================
// POST /api/follows
// Follow a wallet — body: { user_address, wallet_address, pseudonym? }
// =============================================================
followsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { user_address, wallet_address, pseudonym } = body;

    if (!user_address || !wallet_address) {
      return c.json({ data: null, error: 'user_address and wallet_address are required' }, 400);
    }

    const result = await db.query(
      `INSERT INTO user_follows (user_address, wallet_address, pseudonym)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_address, wallet_address) DO NOTHING
       RETURNING id, user_address, wallet_address, pseudonym, created_at`,
      [user_address.toLowerCase(), wallet_address.toLowerCase(), pseudonym || null]
    );

    if (result.rows.length === 0) {
      return c.json({
        data: { already_following: true },
        error: null,
      });
    }

    return c.json({
      data: { follow: result.rows[0] },
      error: null,
    }, 201);
  } catch (err) {
    log.error({ err }, 'POST /api/follows failed');
    return c.json({ data: null, error: 'Failed to follow wallet' }, 500);
  }
});

// =============================================================
// DELETE /api/follows/:wallet_address?user_address=0x...
// Unfollow a wallet
// =============================================================
followsRouter.delete('/:wallet_address', async (c) => {
  try {
    const walletAddress = c.req.param('wallet_address');
    const userAddress = c.req.query('user_address');

    if (!userAddress) {
      return c.json({ data: null, error: 'user_address is required' }, 400);
    }

    await db.query(
      `DELETE FROM user_follows
       WHERE user_address = $1 AND wallet_address = $2`,
      [userAddress.toLowerCase(), walletAddress.toLowerCase()]
    );

    return c.json({
      data: { unfollowed: true },
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'DELETE /api/follows/:address failed');
    return c.json({ data: null, error: 'Failed to unfollow wallet' }, 500);
  }
});
