// =============================================================
// Smart Score Calculator (-100 to +100)
// =============================================================
//
// WHAT: Calculates a composite "Smart Score" for each tracked
//       wallet based on their trading performance.
//
// WHY:  The leaderboard only gives us raw PnL and volume.
//       Smart Score separates skilled traders from lucky ones
//       using 4 weighted components:
//
//       1. Win Rate (40%): trade-level analysis — entry price
//          vs current market price. Confidence-scaled by sample
//          size so 3 trades can't give 100%.
//       2. ROI (30%): real PnL/volume from Polymarket leaderboard.
//          Most reliable signal — comes directly from the platform.
//       3. Consistency (20%): Sharpe ratio from per-trade PnL
//          variance. Steady consistent wins > volatile lucky wins.
//       4. Volume (10%): percentile rank — more volume = more
//          confidence in the score.
//
// SCORING:
//       Raw score: 0-100 (weighted sum of 4 components)
//       Final: (raw - 50) * 2 = -100 to +100
//
//       80-100: Elite Trader (top 1%)
//       60-79:  Smart Money (top 5%)
//       40-59:  Skilled Trader (top 15%)
//       0-39:   Active Trader
//       < 0:    Losing Trader
//
// CONFIDENCE: Win rate and consistency scores are pulled toward
//       neutral (50) when sample size is small. This prevents
//       a wallet with 3 winning trades from scoring 100%.
//       Formula: score = neutral + (raw_score - neutral) * confidence
//       where confidence = min(1, trades / MIN_CONFIDENT_TRADES)
//
// SCHEDULE: Every 30 minutes via BullMQ.
// =============================================================

import { db } from '../db/postgres';
import { createLogger } from '../utils/logger';
import { SMART_SCORE_CONFIG, SMART_SCORE_TAGS } from '@markypie/shared';

const log = createLogger('smart-score');

// Minimum trades before we fully trust win rate / consistency scores.
// Below this, scores are pulled toward neutral (50).
const MIN_CONFIDENT_TRADES = 30;

/** Period filter helpers — returns SQL condition for time filtering */
function getPeriodFilter(period: string): string {
  switch (period) {
    case '7d': return "AND t.platform_timestamp > NOW() - INTERVAL '7 days'";
    case '30d': return "AND t.platform_timestamp > NOW() - INTERVAL '30 days'";
    case '90d': return "AND t.platform_timestamp > NOW() - INTERVAL '90 days'";
    default: return ''; // 'all' — no time filter
  }
}

/**
 * Applies confidence scaling to a component score.
 *
 * With few trades, the score is unreliable — pull it toward neutral.
 * With many trades, trust the raw score fully.
 *
 * confidence = min(1.0, tradeCount / MIN_CONFIDENT_TRADES)
 * result = 50 + (rawScore - 50) * confidence
 *
 * Examples (MIN_CONFIDENT_TRADES = 30):
 *   3 trades, raw 100 → 50 + 50 * 0.1 = 55
 *   15 trades, raw 100 → 50 + 50 * 0.5 = 75
 *   30+ trades, raw 100 → 100 (fully trusted)
 */
function applyConfidence(rawScore: number, tradeCount: number): number {
  const confidence = Math.min(1.0, tradeCount / MIN_CONFIDENT_TRADES);
  return 50 + (rawScore - 50) * confidence;
}

/**
 * Calculates Win Rate Score (0-100).
 *
 * Uses TRADE-LEVEL analysis: for each trade, compare entry price
 * vs current market price to determine if the trade is "winning".
 *
 *   BUY trades:  winning if current_price > entry_price
 *   SELL trades: winning if current_price < entry_price
 *
 * For resolved markets, uses definitive outcome instead of price comparison.
 *
 * Result is confidence-scaled: few trades → pulled toward 50.
 */
async function calcWinRateScore(
  walletId: string,
  period: string
): Promise<{ score: number; winRate: number | null; tradeCount: number }> {
  const periodFilter = getPeriodFilter(period);

  // Get all trades with current market prices
  const result = await db.query(`
    SELECT
      t.side,
      t.price AS entry_price,
      t.outcome AS bet_outcome,
      COALESCE(
        CASE WHEN t.outcome = 'YES' THEN m.yes_price ELSE m.no_price END,
        0.5
      ) AS current_price,
      m.status AS market_status,
      m.outcome AS market_outcome
    FROM trades t
    LEFT JOIN markets m ON t.market_id = m.id
    WHERE t.wallet_id = $1
      AND t.outcome != 'UNKNOWN'
      ${periodFilter}
    ORDER BY t.platform_timestamp DESC
    LIMIT 500
  `, [walletId]);

  const tradeCount = result.rows.length;

  if (tradeCount === 0) {
    // Zero trades with linked markets — use leaderboard PnL as weak signal
    const pnlResult = await db.query(
      'SELECT total_pnl, total_volume FROM wallets WHERE id = $1',
      [walletId]
    );
    const pnl = parseFloat(pnlResult.rows[0]?.total_pnl) || 0;
    const volume = parseFloat(pnlResult.rows[0]?.total_volume) || 0;

    if (volume < 100) {
      return { score: 50, winRate: null, tradeCount: 0 };
    }

    // Weak estimate: positive PnL → slightly above 50, negative → slightly below
    const roiRatio = pnl / volume;
    const estimatedWinRate = Math.min(0.65, Math.max(0.35, 0.5 + roiRatio));
    // Very low confidence — cap distance from neutral at ±5
    const score = Math.min(55, Math.max(45, estimatedWinRate * 100));
    return { score, winRate: estimatedWinRate, tradeCount: 0 };
  }

  // Trade-level win rate
  let wins = 0;
  let total = 0;

  for (const row of result.rows) {
    const entryPrice = parseFloat(row.entry_price) || 0.5;
    const currentPrice = parseFloat(row.current_price) || 0.5;
    const side = row.side;

    // For resolved markets, use definitive outcome
    if (row.market_status === 'resolved' && row.market_outcome) {
      const betOutcome = row.bet_outcome?.toUpperCase();
      const marketOutcome = row.market_outcome?.toUpperCase();
      const won = (side === 'BUY' && betOutcome === marketOutcome) ||
                  (side === 'SELL' && betOutcome !== marketOutcome);
      if (won) wins++;
      total++;
      continue;
    }

    // For active markets, compare entry price vs current price
    let winning: boolean;
    if (side === 'BUY') {
      winning = currentPrice > entryPrice;
    } else {
      winning = currentPrice < entryPrice;
    }

    if (winning) wins++;
    total++;
  }

  if (total === 0) {
    return { score: 50, winRate: null, tradeCount: 0 };
  }

  const winRate = wins / total;
  const rawScore = winRate * 100; // 0-100

  // Apply confidence scaling — few trades pull toward neutral
  const score = applyConfidence(rawScore, total);

  return { score, winRate, tradeCount: total };
}

/**
 * Calculates ROI Score (0-100).
 *
 * Uses Polymarket leaderboard PnL/volume — this is the most reliable
 * data we have because it comes directly from the platform.
 *
 * For period-specific (7d, 90d): calculates unrealized PnL from trades
 * by comparing entry price vs current market price.
 *
 * Normalized: +50% ROI = 100, -50% ROI = 0, 0% = 50
 */
async function calcRoiScore(
  walletId: string,
  period: string
): Promise<{ score: number; roiRaw: number | null }> {
  // Leaderboard PnL/volume — source of truth
  const walletResult = await db.query(
    'SELECT total_pnl, total_volume FROM wallets WHERE id = $1',
    [walletId]
  );
  const leaderboardPnl = parseFloat(walletResult.rows[0]?.total_pnl) || 0;
  const leaderboardVolume = parseFloat(walletResult.rows[0]?.total_volume) || 0;

  // For 'all' and '30d' periods, use leaderboard directly
  if (period === 'all' || period === '30d') {
    if (leaderboardVolume < 100) {
      return { score: 50, roiRaw: null };
    }

    // Polymarket leaderboard 'vol' appears to be recent-period volume,
    // not lifetime. When PnL >> volume (e.g. $32K PnL on $400 vol),
    // the ROI is a data artifact. Fall through to trade-level calculation.
    const rawRoi = (leaderboardPnl / leaderboardVolume) * 100;

    if (Math.abs(rawRoi) <= 500) {
      // Reasonable ROI — trust the leaderboard data
      const cappedRoi = Math.min(200, Math.max(-200, rawRoi));
      const score = Math.min(100, Math.max(0, cappedRoi + 50));
      return { score, roiRaw: rawRoi };
    }
    // ROI > 500% is likely a vol mismatch — fall through to trade-level calc
  }

  // Trade-level ROI: for 7d/90d periods, or when leaderboard ROI is unreliable
  const periodFilter = getPeriodFilter(period);
  const tradeResult = await db.query(`
    SELECT
      t.side,
      t.price AS entry_price,
      t.size,
      t.outcome AS bet_outcome,
      COALESCE(
        CASE WHEN t.outcome = 'YES' THEN m.yes_price ELSE m.no_price END,
        0.5
      ) AS current_price
    FROM trades t
    LEFT JOIN markets m ON t.market_id = m.id
    WHERE t.wallet_id = $1
      AND t.outcome != 'UNKNOWN'
      ${periodFilter}
    LIMIT 500
  `, [walletId]);

  if (tradeResult.rows.length < 3) {
    // Fall back to leaderboard, but cap unreliable ROI
    if (leaderboardVolume < 100) return { score: 50, roiRaw: null };
    const roi = (leaderboardPnl / leaderboardVolume) * 100;
    const cappedRoi = Math.min(200, Math.max(-200, roi));
    return { score: Math.min(100, Math.max(0, cappedRoi + 50)), roiRaw: cappedRoi };
  }

  let totalPnl = 0;
  let totalCapital = 0;

  for (const row of tradeResult.rows) {
    const entryPrice = parseFloat(row.entry_price) || 0.5;
    const currentPrice = parseFloat(row.current_price) || 0.5;
    const size = parseFloat(row.size) || 0;

    if (size === 0 || entryPrice === 0) continue;

    const shares = size / entryPrice;
    totalCapital += size;

    if (row.side === 'BUY') {
      totalPnl += (currentPrice - entryPrice) * shares;
    } else {
      totalPnl += (entryPrice - currentPrice) * shares;
    }
  }

  if (totalCapital < 100) {
    return { score: 50, roiRaw: null };
  }

  const roi = (totalPnl / totalCapital) * 100;
  const cappedRoi = Math.min(200, Math.max(-200, roi));
  const score = Math.min(100, Math.max(0, cappedRoi + 50));

  return { score, roiRaw: cappedRoi };
}

/**
 * Calculates Consistency/Sharpe Score (0-100).
 *
 * Approximates Sharpe ratio from per-trade PnL variance.
 * Sharpe = mean(trade_pnls) / stddev(trade_pnls)
 *
 * Normalized: Sharpe 2.0 → 100, 0 → 50, -2.0 → 0
 * Confidence-scaled: few trades pull toward neutral.
 */
async function calcConsistencyScore(
  walletId: string,
  period: string
): Promise<{ score: number; sharpeRaw: number | null; tradeCount: number }> {
  const periodFilter = getPeriodFilter(period);

  const result = await db.query(`
    SELECT
      t.side,
      t.price AS entry_price,
      t.size,
      COALESCE(
        CASE WHEN t.outcome = 'YES' THEN m.yes_price ELSE m.no_price END,
        0.5
      ) AS current_price
    FROM trades t
    LEFT JOIN markets m ON t.market_id = m.id
    WHERE t.wallet_id = $1
      AND t.outcome != 'UNKNOWN'
      ${periodFilter}
    ORDER BY t.platform_timestamp DESC
    LIMIT 200
  `, [walletId]);

  if (result.rows.length < SMART_SCORE_CONFIG.MIN_TRADES_FOR_SHARPE) {
    return { score: 50, sharpeRaw: null, tradeCount: result.rows.length };
  }

  // Calculate per-trade PnL
  const pnls: number[] = [];
  for (const row of result.rows) {
    const entryPrice = parseFloat(row.entry_price) || 0.5;
    const currentPrice = parseFloat(row.current_price) || 0.5;
    const size = parseFloat(row.size) || 0;

    if (size === 0 || entryPrice === 0) continue;

    const shares = size / entryPrice;
    const pnl = row.side === 'BUY'
      ? (currentPrice - entryPrice) * shares
      : (entryPrice - currentPrice) * shares;

    pnls.push(pnl);
  }

  if (pnls.length < SMART_SCORE_CONFIG.MIN_TRADES_FOR_SHARPE) {
    return { score: 50, sharpeRaw: null, tradeCount: pnls.length };
  }

  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((sum, val) => sum + (val - mean) ** 2, 0) / pnls.length;
  const stddev = Math.sqrt(variance);

  const sharpe = stddev > 0 ? mean / stddev : 0;

  // Normalize: Sharpe 2.0 → 100, 0 → 50, -2.0 → 0
  const rawScore = Math.min(100, Math.max(0, (sharpe + 2) / 4 * 100));

  // Apply confidence scaling
  const score = applyConfidence(rawScore, pnls.length);

  return { score, sharpeRaw: sharpe, tradeCount: pnls.length };
}

/**
 * Calculates Volume Score (0-100).
 *
 * Log-scale percentile rank among all wallets.
 * More volume = more data points = higher confidence in the score.
 */
async function calcVolumeScore(
  walletId: string,
  allVolumes: { below: Map<number, number>; total: number }
): Promise<number> {
  const walletResult = await db.query(
    'SELECT total_volume FROM wallets WHERE id = $1',
    [walletId]
  );
  const volume = parseFloat(walletResult.rows[0]?.total_volume) || 0;

  if (volume === 0) return 0;

  // Get percentile rank
  const rankResult = await db.query(
    `SELECT COUNT(*) AS below FROM wallets WHERE total_volume < $1 AND total_volume > 0`,
    [volume]
  );
  const below = parseInt(rankResult.rows[0]?.below) || 0;

  return Math.min(100, (below / allVolumes.total) * 100);
}

/**
 * Calculates category expertise for a wallet.
 * Uses trade-level PnL (entry vs current price) — NOT the broken BUY=-size formula.
 */
async function calcCategoryExpertise(walletId: string): Promise<Record<string, number>> {
  const result = await db.query(`
    SELECT
      m.category,
      t.side,
      t.price AS entry_price,
      t.size,
      COALESCE(
        CASE WHEN t.outcome = 'YES' THEN m.yes_price ELSE m.no_price END,
        0.5
      ) AS current_price
    FROM trades t
    LEFT JOIN markets m ON t.market_id = m.id
    WHERE t.wallet_id = $1
      AND t.outcome != 'UNKNOWN'
  `, [walletId]);

  // Aggregate PnL per category
  const catStats: Record<string, { pnl: number; volume: number }> = {};

  for (const row of result.rows) {
    const cat = row.category || 'other';
    if (!catStats[cat]) catStats[cat] = { pnl: 0, volume: 0 };

    const entryPrice = parseFloat(row.entry_price) || 0.5;
    const currentPrice = parseFloat(row.current_price) || 0.5;
    const size = parseFloat(row.size) || 0;

    if (size === 0 || entryPrice === 0) continue;

    const shares = size / entryPrice;
    const pnl = row.side === 'BUY'
      ? (currentPrice - entryPrice) * shares
      : (entryPrice - currentPrice) * shares;

    catStats[cat].pnl += pnl;
    catStats[cat].volume += size;
  }

  const expertise: Record<string, number> = {};
  for (const [cat, stats] of Object.entries(catStats)) {
    if (stats.volume <= 0) continue;
    const roi = stats.pnl / stats.volume;
    // Normalize: +50% ROI → 1.0, -50% → 0.0, 0% → 0.5
    expertise[cat] = Math.min(1, Math.max(0, roi + 0.5));
  }

  return expertise;
}

/**
 * Gets the Smart Score tag based on score value.
 */
function getSmartTag(score: number): string {
  if (score >= SMART_SCORE_TAGS.ELITE_TRADER.min) return 'elite_trader';
  if (score >= SMART_SCORE_TAGS.SMART_MONEY.min) return 'smart_money';
  if (score >= SMART_SCORE_TAGS.SKILLED_TRADER.min) return 'skilled_trader';
  if (score >= SMART_SCORE_TAGS.ACTIVE_TRADER.min) return 'active_trader';
  return 'losing_trader';
}

/**
 * Main Smart Score calculation — called by BullMQ every 30 minutes.
 *
 * For each wallet, for each period (7d, 30d, 90d, all):
 * 1. Calculate 4 component scores (win rate, ROI, consistency, volume)
 * 2. Weighted sum → raw 0-100
 * 3. Normalize to -100 to +100
 * 4. UPSERT into wallet_scores table
 * 5. Update wallet tags
 */
export async function calculateSmartScores(): Promise<void> {
  log.info('Starting Smart Score calculation...');
  const startTime = Date.now();

  try {
    // Get all wallets that have some trading activity
    const wallets = await db.query(`
      SELECT w.id, w.address, w.total_volume, w.total_pnl
      FROM wallets w
      WHERE w.total_volume > 0
         OR EXISTS (SELECT 1 FROM trades t WHERE t.wallet_id = w.id LIMIT 1)
      ORDER BY w.total_volume DESC NULLS LAST
    `);

    log.info({ walletCount: wallets.rows.length }, 'Scoring wallets');

    // Pre-fetch total wallet count for volume percentile
    const totalVolumeResult = await db.query(
      'SELECT COUNT(*) AS total FROM wallets WHERE total_volume > 0'
    );
    const volumeContext = {
      below: new Map<number, number>(),
      total: parseInt(totalVolumeResult.rows[0]?.total) || 1,
    };

    const periods = ['7d', '30d', '90d', 'all'];
    let scoredCount = 0;

    for (const wallet of wallets.rows) {
      for (const period of periods) {
        // Calculate all 4 components
        const winRate = await calcWinRateScore(wallet.id, period);
        const roi = await calcRoiScore(wallet.id, period);
        const consistency = await calcConsistencyScore(wallet.id, period);
        const volumeScore = await calcVolumeScore(wallet.id, volumeContext);

        // Weighted raw score (0-100)
        const rawScore =
          (winRate.score * SMART_SCORE_CONFIG.WIN_RATE_WEIGHT) +
          (roi.score * SMART_SCORE_CONFIG.ROI_WEIGHT) +
          (consistency.score * SMART_SCORE_CONFIG.CONSISTENCY_WEIGHT) +
          (volumeScore * SMART_SCORE_CONFIG.VOLUME_WEIGHT);

        // Normalize to -100 to +100
        const smartScore = Math.round((rawScore - 50) * 2);

        // Data quality based on trade count
        const totalTrades = winRate.tradeCount;
        const dataQuality = totalTrades >= 50 ? 'high'
          : totalTrades >= 10 ? 'medium'
          : 'low';

        // PnL and volume from leaderboard
        const pnl = parseFloat(wallet.total_pnl) || 0;
        const volume = parseFloat(wallet.total_volume) || 0;

        // Category expertise (only for 'all' period to save queries)
        let categoryExpertise: Record<string, number> | null = null;
        if (period === 'all') {
          categoryExpertise = await calcCategoryExpertise(wallet.id);
        }

        // UPSERT wallet_scores (includes component score breakdown)
        await db.query(
          `INSERT INTO wallet_scores (
            wallet_id, period,
            total_pnl, total_volume,
            win_rate, total_markets, winning_markets,
            avg_position_size,
            roi, sharpe_ratio, smart_score,
            win_rate_score, roi_score, consistency_score, volume_score,
            data_quality,
            category_expertise, calculated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
          ON CONFLICT (wallet_id, period) DO UPDATE SET
            total_pnl = $3,
            total_volume = $4,
            win_rate = $5,
            total_markets = $6,
            winning_markets = $7,
            avg_position_size = $8,
            roi = $9,
            sharpe_ratio = $10,
            smart_score = $11,
            win_rate_score = $12,
            roi_score = $13,
            consistency_score = $14,
            volume_score = $15,
            data_quality = $16,
            category_expertise = COALESCE($17, wallet_scores.category_expertise),
            calculated_at = NOW()`,
          [
            wallet.id,                                        // $1
            period,                                           // $2
            pnl,                                              // $3
            volume,                                           // $4
            winRate.winRate,                                   // $5
            totalTrades,                                      // $6
            winRate.winRate !== null ? Math.round(winRate.winRate * totalTrades) : 0, // $7
            volume > 0 && totalTrades > 0 ? volume / totalTrades : null,  // $8
            roi.roiRaw,                                       // $9
            consistency.sharpeRaw,                             // $10
            smartScore,                                       // $11
            Math.round(winRate.score),                        // $12: win_rate_score
            Math.round(roi.score),                            // $13: roi_score
            Math.round(consistency.score),                    // $14: consistency_score
            Math.round(volumeScore),                          // $15: volume_score
            dataQuality,                                      // $16: data_quality
            categoryExpertise ? JSON.stringify(categoryExpertise) : null,  // $17
          ]
        );
      }

      // Update wallet tags based on the 'all' period score
      const allScoreResult = await db.query(
        `SELECT smart_score FROM wallet_scores WHERE wallet_id = $1 AND period = 'all'`,
        [wallet.id]
      );
      const allScore = allScoreResult.rows[0]?.smart_score ?? 0;
      const tag = getSmartTag(allScore);

      // Replace existing score-related tags, keep other tags
      await db.query(
        `UPDATE wallets
         SET tags = array_remove(
           array_remove(
             array_remove(
               array_remove(
                 array_remove(tags, 'elite_trader'),
                 'smart_money'),
               'skilled_trader'),
             'active_trader'),
           'losing_trader')
           || ARRAY[$1]::text[]
         WHERE id = $2`,
        [tag, wallet.id]
      );

      scoredCount++;

      if (scoredCount % 50 === 0) {
        log.debug({ scored: scoredCount, total: wallets.rows.length }, 'Scoring progress');
      }
    }

    const duration = Date.now() - startTime;
    log.info(
      { walletsScored: scoredCount, durationMs: duration },
      'Smart Score calculation complete'
    );
  } catch (err) {
    log.error({ err }, 'Smart Score calculation failed');
    throw err;
  }
}
