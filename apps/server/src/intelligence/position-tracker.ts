// =============================================================
// Position Tracker
// =============================================================
//
// WHAT: Aggregates trades into positions — how many shares each
//       wallet holds in each market, at what average price, and
//       what their unrealized PnL is.
//
// WHY:  Positions are needed for:
//       - Smart Score: which positions resolved as wins/losses
//       - Consensus: what does smart money hold in each market
//       - Wallet profiles: show current holdings on the dashboard
//
// HOW:  Runs every 5 minutes via BullMQ.
//       1. Find all (wallet, market, outcome) combos from trades
//       2. Aggregate BUYs and SELLs into net position
//       3. Calculate avg entry price, cost basis, unrealized PnL
//       4. UPSERT into positions table
//
// ACCOUNTING:
//       BUY:  adds shares → new_size = old_size + (trade.size / trade.price)
//             weighted avg price updates
//       SELL: removes shares → realized PnL = (sell_price - avg_price) * shares_sold
//             remaining position keeps same avg_price
// =============================================================

import { db } from '../db/postgres';
import { createLogger } from '../utils/logger';

const log = createLogger('position-tracker');

/**
 * Main position update function — called by BullMQ every 5 minutes.
 *
 * Uses a SQL-based aggregation approach for efficiency:
 * 1. Single query to get all trade aggregates grouped by (wallet, market, outcome)
 * 2. Fetch current market prices for PnL calculation
 * 3. UPSERT all positions in batch
 */
export async function updatePositions(): Promise<void> {
  log.info('Starting position update...');
  const startTime = Date.now();

  try {
    // Get all unique (wallet_id, market_id, outcome) combos with aggregated trade data.
    // This single query replaces per-wallet iteration.
    //
    // For each combo we calculate:
    // - total bought (sum of BUY sizes in USD)
    // - total sold (sum of SELL sizes in USD)
    // - buy count and sell count
    // - weighted avg buy price = sum(size) / sum(size/price) = total_usd / total_shares
    const aggregates = await db.query(`
      SELECT
        t.wallet_id,
        t.market_id,
        t.outcome,
        -- BUY side aggregates
        COALESCE(SUM(CASE WHEN t.side = 'BUY' THEN t.size ELSE 0 END), 0) AS total_buy_usd,
        COALESCE(SUM(CASE WHEN t.side = 'BUY' AND t.price > 0 THEN t.size / t.price ELSE 0 END), 0) AS total_buy_shares,
        -- SELL side aggregates
        COALESCE(SUM(CASE WHEN t.side = 'SELL' THEN t.size ELSE 0 END), 0) AS total_sell_usd,
        COALESCE(SUM(CASE WHEN t.side = 'SELL' AND t.price > 0 THEN t.size / t.price ELSE 0 END), 0) AS total_sell_shares,
        -- Trade counts
        COUNT(*) FILTER (WHERE t.side = 'BUY') AS buy_count,
        COUNT(*) FILTER (WHERE t.side = 'SELL') AS sell_count
      FROM trades t
      WHERE t.wallet_id IS NOT NULL
        AND t.market_id IS NOT NULL
      GROUP BY t.wallet_id, t.market_id, t.outcome
      HAVING SUM(CASE WHEN t.side = 'BUY' THEN t.size ELSE 0 END) > 0
    `);

    if (aggregates.rows.length === 0) {
      log.info('No trade data to build positions from');
      return;
    }

    log.debug({ combos: aggregates.rows.length }, 'Processing position aggregates');

    // Batch fetch current market prices for all markets in one query
    const marketIds = [...new Set(aggregates.rows.map((r: any) => r.market_id))];
    const pricesResult = await db.query(
      `SELECT id, yes_price, no_price FROM markets WHERE id = ANY($1)`,
      [marketIds]
    );

    const priceMap = new Map<string, { yes_price: number; no_price: number }>();
    for (const row of pricesResult.rows) {
      priceMap.set(row.id, {
        yes_price: parseFloat(row.yes_price) || 0.5,
        no_price: parseFloat(row.no_price) || 0.5,
      });
    }

    let upsertedCount = 0;

    for (const row of aggregates.rows) {
      const totalBuyUsd = parseFloat(row.total_buy_usd) || 0;
      const totalBuyShares = parseFloat(row.total_buy_shares) || 0;
      const totalSellUsd = parseFloat(row.total_sell_usd) || 0;
      const totalSellShares = parseFloat(row.total_sell_shares) || 0;

      // Net position: shares bought minus shares sold
      const netShares = totalBuyShares - totalSellShares;
      if (netShares <= 0) continue; // Position fully closed

      // Average entry price: total USD spent / total shares bought
      const avgPrice = totalBuyShares > 0 ? totalBuyUsd / totalBuyShares : 0;

      // Cost basis: value of remaining shares at avg entry price
      const initialValue = netShares * avgPrice;

      // Realized PnL from sells: sold at market price, bought at avg price
      // realized = total_sell_usd - (total_sell_shares * avg_price)
      const realizedPnl = totalSellUsd - (totalSellShares * avgPrice);

      // Current market price for this outcome
      const prices = priceMap.get(row.market_id);
      const currentPrice = row.outcome === 'YES'
        ? (prices?.yes_price ?? 0.5)
        : (prices?.no_price ?? 0.5);

      // Current value and unrealized PnL
      const currentValue = netShares * currentPrice;
      const unrealizedPnl = currentValue - initialValue;
      const unrealizedPnlPct = initialValue > 0 ? (unrealizedPnl / initialValue) * 100 : 0;

      // UPSERT position
      await db.query(
        `INSERT INTO positions (
          wallet_id, market_id, outcome,
          size, avg_price, initial_value,
          current_value, unrealized_pnl, unrealized_pnl_pct,
          realized_pnl, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (wallet_id, market_id, outcome) DO UPDATE SET
          size = $4,
          avg_price = $5,
          initial_value = $6,
          current_value = $7,
          unrealized_pnl = $8,
          unrealized_pnl_pct = $9,
          realized_pnl = $10,
          updated_at = NOW()`,
        [
          row.wallet_id,
          row.market_id,
          row.outcome,
          netShares,
          avgPrice,
          initialValue,
          currentValue,
          unrealizedPnl,
          unrealizedPnlPct,
          realizedPnl,
        ]
      );

      upsertedCount++;
    }

    const duration = Date.now() - startTime;
    log.info(
      { positions: upsertedCount, durationMs: duration },
      'Position update complete'
    );
  } catch (err) {
    log.error({ err }, 'Position update failed');
    throw err;
  }
}
