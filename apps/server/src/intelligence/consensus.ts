// =============================================================
// Smart Money Consensus
// =============================================================
//
// WHAT: For each market, calculates what percentage of "smart money"
//       (wallets with Smart Score >= 60) is betting YES vs NO.
//
// WHY:  This is one of MarkyPie's killer features. Users can see:
//       "72% of smart money thinks YES on 'Will Fed cut rates?'"
//       This is a signal that doesn't exist anywhere else.
//
// HOW:  Runs every 2 minutes via BullMQ.
//       1. Single JOIN query: positions × wallet_scores (score >= 60)
//       2. Group by market: sum YES value vs NO value
//       3. Weight by Smart Score (higher score = more influence)
//       4. Store in Redis with 5-min TTL for instant dashboard access
//
// REDIS KEY: consensus:market:{market_id}
// VALUE: JSON { yes_pct, no_pct, weighted_yes_pct, weighted_no_pct,
//               smart_wallet_count, total_smart_value, updated_at }
//
// SCHEDULE: Every 2 minutes via BullMQ.
// =============================================================

import { db } from '../db/postgres';
import { redis } from '../db/redis';
import { createLogger } from '../utils/logger';
import { REDIS_KEYS, SMART_SCORE_CONFIG } from '@markypie/shared';
import { sendConsensusShiftAlert } from '../alerts/telegram';

const log = createLogger('consensus');

/** TTL for consensus cache in Redis (seconds) */
const CONSENSUS_TTL_SECONDS = 300; // 5 minutes

/**
 * Main consensus calculation — called by BullMQ every 2 minutes.
 *
 * Uses a single efficient JOIN query to get all smart money positions
 * across all markets, then groups and calculates in JavaScript.
 */
export async function calculateConsensus(): Promise<void> {
  log.info('Starting Smart Money Consensus calculation...');
  const startTime = Date.now();

  try {
    // Single query: get all positions from wallets with smart_score >= threshold
    // Uses the '30d' period as the most relevant timeframe
    const result = await db.query(`
      SELECT
        p.market_id,
        p.outcome,
        p.initial_value,
        p.size,
        ws.smart_score
      FROM positions p
      JOIN wallet_scores ws ON p.wallet_id = ws.wallet_id AND ws.period = '30d'
      WHERE ws.smart_score >= $1
        AND p.size > 0
      ORDER BY p.market_id
    `, [SMART_SCORE_CONFIG.SMART_MONEY_THRESHOLD]);

    if (result.rows.length === 0) {
      log.info('No smart money positions found (scores may not be calculated yet)');
      return;
    }

    // Group by market_id and calculate consensus
    const marketConsensus = new Map<string, {
      yesValue: number;
      noValue: number;
      weightedYes: number;
      weightedNo: number;
      wallets: Set<string>;
    }>();

    for (const row of result.rows) {
      const marketId = row.market_id;
      const value = parseFloat(row.initial_value) || 0;
      const score = parseInt(row.smart_score) || 0;

      if (!marketConsensus.has(marketId)) {
        marketConsensus.set(marketId, {
          yesValue: 0,
          noValue: 0,
          weightedYes: 0,
          weightedNo: 0,
          wallets: new Set(),
        });
      }

      const mc = marketConsensus.get(marketId)!;
      mc.wallets.add(row.wallet_id);

      if (row.outcome === 'YES') {
        mc.yesValue += value;
        mc.weightedYes += value * score;
      } else {
        mc.noValue += value;
        mc.weightedNo += value * score;
      }
    }

    // Write consensus to Redis
    let marketsUpdated = 0;
    const pipeline = redis.pipeline();

    for (const [marketId, mc] of marketConsensus) {
      const totalValue = mc.yesValue + mc.noValue;
      const weightedTotal = mc.weightedYes + mc.weightedNo;

      if (totalValue === 0) continue;

      const consensus = {
        market_id: marketId,
        yes_pct: mc.yesValue / totalValue,
        no_pct: mc.noValue / totalValue,
        weighted_yes_pct: weightedTotal > 0 ? mc.weightedYes / weightedTotal : 0.5,
        weighted_no_pct: weightedTotal > 0 ? mc.weightedNo / weightedTotal : 0.5,
        smart_wallet_count: mc.wallets.size,
        total_smart_value: totalValue,
        updated_at: Date.now(),
      };

      const key = REDIS_KEYS.smartMoneyConsensus(marketId);

      // Check if consensus flipped (YES→NO or NO→YES) compared to previous
      const previousRaw = await redis.get(key);
      if (previousRaw) {
        try {
          const previous = JSON.parse(previousRaw);
          const prevYesPct = (previous.yes_pct || 0) * 100;
          const currYesPct = consensus.yes_pct * 100;

          // Only alert if enough smart wallets and enough value
          if (mc.wallets.size >= 3 && totalValue >= 1000) {
            // Look up market title for the alert
            const marketRow = await db.query('SELECT title FROM markets WHERE id = $1', [marketId]);
            const marketTitle = marketRow.rows[0]?.title || 'Unknown market';

            sendConsensusShiftAlert({
              marketTitle,
              marketId,
              previousYesPct: prevYesPct,
              currentYesPct: currYesPct,
              smartWalletCount: mc.wallets.size,
              totalSmartValue: totalValue,
            }).catch(err => log.error({ err }, 'Telegram consensus shift alert failed'));
          }
        } catch {}
      }

      pipeline.set(key, JSON.stringify(consensus), 'EX', CONSENSUS_TTL_SECONDS);
      marketsUpdated++;
    }

    await pipeline.exec();

    const duration = Date.now() - startTime;
    log.info(
      { marketsWithConsensus: marketsUpdated, smartPositions: result.rows.length, durationMs: duration },
      'Smart Money Consensus calculation complete'
    );
  } catch (err) {
    log.error({ err }, 'Smart Money Consensus calculation failed');
    throw err;
  }
}
