// =============================================================
// Market Safety Score Calculator (0-100)
// =============================================================
//
// APPROACH: Inspired by GMGN.ai / GoPlus token security scoring.
//
// GMGN scores tokens using 27 binary security parameters with
// weighted points (Critical=100, High=50, Medium=30, Low=10-20)
// plus trust signals that subtract points.
//
// We adapt this for prediction markets:
// - Instead of "is it a honeypot?" → "is liquidity too thin to exit?"
// - Instead of "is mint disabled?" → "does the market have clear resolution?"
// - Instead of "rug pull history?" → "is whale concentration dangerous?"
// - Instead of "contract verified?" → "is it on a regulated platform?"
//
// HOW IT WORKS:
//   Start at 100 (perfectly safe).
//   Each risk flag SUBTRACTS points based on severity.
//   Each trust signal ADDS points back (capped at 100).
//   Final score = max(0, min(100, 100 - totalRiskPoints + trustPoints))
//
// RISK FLAGS (subtract points):
//   Critical (20 pts):  Extreme dangers — zero liquidity, no description
//   High (12 pts):      Serious concerns — very low volume, whale-dominated
//   Medium (6 pts):     Moderate issues — low trade diversity, unclear resolution
//   Low (3 pts):        Minor concerns — missing metadata, short timeframe
//
// TRUST FLAGS (add points):
//   High trust (10 pts):  Strong positives — regulated platform, cross-platform
//   Medium trust (5 pts): Good signals — resolution source, high diversity
//   Low trust (2 pts):    Minor positives — has description, dates in criteria
//
// FINAL CLASSIFICATION:
//   80-100: Very Safe   — green badge on dashboard
//   60-79:  Safe         — no badge needed
//   40-59:  Moderate     — yellow warning
//   20-39:  Risky        — orange warning
//   0-19:   Very Risky   — red warning
//
// SCHEDULE: Every 10 minutes via BullMQ.
// =============================================================

import { db } from '../db/postgres';
import { createLogger } from '../utils/logger';

const log = createLogger('market-safety');

// =============================================================
// Risk & Trust Flag Definitions
// =============================================================

interface SafetyFlag {
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  points: number;
  triggered: boolean;
}

interface TrustFlag {
  name: string;
  level: 'high' | 'medium' | 'low';
  points: number;
  triggered: boolean;
}

// Points are balanced around a 50-point midpoint:
//
// Risk budget  (pulls DOWN from 50 toward 0):
//   3 critical (15 each) + 6 high (8 each) + 6 medium (4 each) + 4 low (2 each)
//   = 45 + 48 + 24 + 8 = 125 max risk (50 → well below 0, clamped)
//
// Trust budget (pushes UP from 50 toward 100):
//   4 high (8 each) + 6 medium (4 each) + 4 low (2 each)
//   = 32 + 24 + 8 = 64 max trust (50 → 114, but not all flags can trigger together)
//
// Realistic ranges:
//   Great Polymarket market: 50 - 0 + ~35 trust = 85
//   Great Kalshi market:     50 - 8 + ~30 trust = 72
//   Average market:          50 - 10 + ~15 trust = 55
//   Bad market:              50 - 35 + ~5 trust = 20
//   Terrible market:         50 - 50 + 0 trust = 0
//
const RISK_POINTS = { critical: 15, high: 8, medium: 4, low: 2 };
const TRUST_POINTS = { high: 8, medium: 4, low: 2 };

// Baseline score — neutral, market must prove itself safe
const BASELINE_SCORE = 50;

// =============================================================
// Percentile Thresholds
// Computed once per scoring run from actual data distribution.
// Flag triggers use these instead of hardcoded dollar amounts.
// =============================================================

interface Thresholds {
  // Volume percentiles
  volumeP10: number;   // bottom 10% → very low volume (high risk)
  volumeP25: number;   // bottom 25% → low volume (medium risk)
  volumeP75: number;   // top 25% → good volume (medium trust)
  volumeP90: number;   // top 10% → high volume (high trust)

  // Liquidity percentiles
  liquidityP05: number; // bottom 5% → near-zero liquidity (critical risk)
  liquidityP25: number; // bottom 25% → low liquidity (medium risk)
  liquidityP75: number; // top 25% → good liquidity (medium trust)

  // Trade count percentiles (Polymarket only)
  tradeCountP25: number; // bottom 25% → few trades (medium risk)

  // Unique wallets percentiles (Polymarket only)
  uniqueWalletsP75: number; // top 25% → high diversity (high trust)
}

/**
 * Computes percentile value from a sorted array.
 * p = 0.1 → 10th percentile (bottom 10%)
 * p = 0.9 → 90th percentile (top 10%)
 */
function percentileValue(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/**
 * Builds all threshold values from raw data arrays.
 * Called once per scoring run before processing any markets.
 */
function buildThresholds(
  volumes: number[],
  liquidities: number[],
  tradeCounts: number[],
  uniqueWallets: number[]
): Thresholds {
  const vs = [...volumes].sort((a, b) => a - b);
  const ls = [...liquidities].sort((a, b) => a - b);
  const ts = [...tradeCounts].sort((a, b) => a - b);
  const ws = [...uniqueWallets].sort((a, b) => a - b);

  return {
    volumeP10:        percentileValue(vs, 0.10),
    volumeP25:        percentileValue(vs, 0.25),
    volumeP75:        percentileValue(vs, 0.75),
    volumeP90:        percentileValue(vs, 0.90),
    liquidityP05:     percentileValue(ls, 0.05),
    liquidityP25:     percentileValue(ls, 0.25),
    liquidityP75:     percentileValue(ls, 0.75),
    tradeCountP25:    percentileValue(ts, 0.25),
    uniqueWalletsP75: percentileValue(ws, 0.75),
  };
}

// =============================================================
// Risk Flag Checks
// =============================================================

function checkRiskFlags(
  market: any,
  tradeStats: { trade_count: number; whale_count: number; unique_wallets: number } | null,
  thresholds: Thresholds
): SafetyFlag[] {
  const volume = parseFloat(market.volume) || 0;
  const liquidity = parseFloat(market.liquidity) || 0;
  const yesPrice = parseFloat(market.yes_price) || 0;
  const noPrice = parseFloat(market.no_price) || 0;
  const description = (market.description || '').toLowerCase();
  const endDate = market.end_date ? new Date(market.end_date).getTime() : null;
  const now = Date.now();

  const flags: SafetyFlag[] = [];

  // ---- CRITICAL FLAGS (15 pts each) ----

  // Near-zero liquidity — bottom 5% of all markets = can't exit
  // Uses percentile: p05 adapts to actual distribution
  flags.push({
    name: 'zero_liquidity',
    severity: 'critical',
    points: RISK_POINTS.critical,
    triggered: liquidity <= thresholds.liquidityP05,
  });

  // No description — impossible to know resolution criteria
  // ABSOLUTE: zero description is always a red flag
  flags.push({
    name: 'no_description',
    severity: 'critical',
    points: RISK_POINTS.critical,
    triggered: description.length === 0,
  });

  // Broken price formation — YES + NO far from 1.00
  // ABSOLUTE: math property, not relative
  const priceSum = yesPrice + noPrice;
  flags.push({
    name: 'broken_price_formation',
    severity: 'critical',
    points: RISK_POINTS.critical,
    triggered: priceSum > 0 && Math.abs(priceSum - 1) > 0.30,
  });

  // ---- HIGH FLAGS (8 pts each) ----

  // No trade transparency — Kalshi hides all individual trades
  // ABSOLUTE: platform property, not relative
  flags.push({
    name: 'no_trade_transparency',
    severity: 'high',
    points: RISK_POINTS.high,
    triggered: market.platform === 'kalshi',
  });

  // Very low volume — bottom 10% of all markets
  // PERCENTILE: adapts to actual data distribution
  flags.push({
    name: 'very_low_volume',
    severity: 'high',
    points: RISK_POINTS.high,
    triggered: volume < thresholds.volumeP10,
  });

  // Whale dominated — >50% of trades are whale-sized
  // ABSOLUTE: ratio is ratio everywhere, not relative
  const whaleRatio = tradeStats && tradeStats.trade_count > 0
    ? tradeStats.whale_count / tradeStats.trade_count : 0;
  flags.push({
    name: 'whale_dominated',
    severity: 'high',
    points: RISK_POINTS.high,
    triggered: tradeStats !== null && tradeStats.trade_count >= 3 && whaleRatio > 0.5,
  });

  // Single wallet — only 1-2 unique wallets with 3+ trades = coordinated
  // ABSOLUTE: 1-2 wallets is always suspicious, not relative
  flags.push({
    name: 'single_wallet',
    severity: 'high',
    points: RISK_POINTS.high,
    triggered: tradeStats !== null && tradeStats.unique_wallets <= 2 && tradeStats.trade_count >= 3,
  });

  // Price stuck at extreme — near 0 or 1 with actual volume = dead market
  // ABSOLUTE: extreme prices near 0/1 always mean no active discovery
  flags.push({
    name: 'price_stuck_extreme',
    severity: 'high',
    points: RISK_POINTS.high,
    triggered: volume > 0 && (yesPrice >= 0.99 || yesPrice <= 0.01),
  });

  // ---- MEDIUM FLAGS (4 pts each) ----

  // Low volume — bottom 10-25% range
  // PERCENTILE: between very_low (p10) and p25
  flags.push({
    name: 'low_volume',
    severity: 'medium',
    points: RISK_POINTS.medium,
    triggered: volume >= thresholds.volumeP10 && volume < thresholds.volumeP25,
  });

  // Low liquidity — bottom 25% (but above critical p05)
  // PERCENTILE: adapts to actual liquidity distribution
  flags.push({
    name: 'low_liquidity',
    severity: 'medium',
    points: RISK_POINTS.medium,
    triggered: liquidity > thresholds.liquidityP05 && liquidity < thresholds.liquidityP25,
  });

  // Few trades — bottom 25% of markets with trade data
  // PERCENTILE: what counts as "few" depends on the dataset
  flags.push({
    name: 'few_trades',
    severity: 'medium',
    points: RISK_POINTS.medium,
    triggered: tradeStats !== null && tradeStats.trade_count < thresholds.tradeCountP25,
  });

  // Moderate whale concentration — 20-50% whale trades
  // ABSOLUTE: ratio thresholds are always meaningful
  flags.push({
    name: 'moderate_whale_concentration',
    severity: 'medium',
    points: RISK_POINTS.medium,
    triggered: tradeStats !== null && tradeStats.trade_count >= 3 && whaleRatio > 0.2 && whaleRatio <= 0.5,
  });

  // Weak price formation — off by 10-30%
  // ABSOLUTE: math property
  flags.push({
    name: 'weak_price_formation',
    severity: 'medium',
    points: RISK_POINTS.medium,
    triggered: priceSum > 0 && Math.abs(priceSum - 1) > 0.10 && Math.abs(priceSum - 1) <= 0.30,
  });

  // Very far resolution — >1 year away
  // ABSOLUTE: time is absolute
  flags.push({
    name: 'very_far_resolution',
    severity: 'medium',
    points: RISK_POINTS.medium,
    triggered: endDate !== null && (endDate - now) > 365 * 24 * 60 * 60 * 1000,
  });

  // ---- LOW FLAGS (2 pts each) ----

  // No resolution criteria keywords
  // ABSOLUTE: keyword presence is a fact
  const hasResolutionCriteria = /\b(resolve[ds]?|resolution|settled|determined|based on|according to|if and only if|will be considered|outcome)\b/.test(description);
  flags.push({
    name: 'no_resolution_criteria',
    severity: 'low',
    points: RISK_POINTS.low,
    triggered: description.length > 0 && !hasResolutionCriteria,
  });

  // Far resolution — 6-12 months away
  // ABSOLUTE: time is absolute
  flags.push({
    name: 'far_resolution',
    severity: 'low',
    points: RISK_POINTS.low,
    triggered: endDate !== null
      && (endDate - now) > 180 * 24 * 60 * 60 * 1000
      && (endDate - now) <= 365 * 24 * 60 * 60 * 1000,
  });

  // No end date — unknown resolution timeline
  // ABSOLUTE: missing end date is always a concern
  flags.push({
    name: 'no_end_date',
    severity: 'low',
    points: RISK_POINTS.low,
    triggered: endDate === null,
  });

  // Uncategorized — missing category metadata
  // ABSOLUTE: category is either there or not
  flags.push({
    name: 'uncategorized',
    severity: 'low',
    points: RISK_POINTS.low,
    triggered: (market.category || 'other') === 'other',
  });

  return flags;
}

// =============================================================
// Trust Flag Checks (positive signals)
// =============================================================

function checkTrustFlags(
  market: any,
  tradeStats: { trade_count: number; whale_count: number; unique_wallets: number } | null,
  thresholds: Thresholds
): TrustFlag[] {
  const volume = parseFloat(market.volume) || 0;
  const liquidity = parseFloat(market.liquidity) || 0;
  const description = (market.description || '').toLowerCase();
  const title = (market.title || '').toLowerCase();
  const category = market.category || 'other';

  const flags: TrustFlag[] = [];

  // ---- HIGH TRUST (8 pts each) ----

  // Regulated platform — CFTC regulated = strong oversight
  // ABSOLUTE: platform is either regulated or not
  flags.push({
    name: 'regulated_platform',
    level: 'high',
    points: TRUST_POINTS.high,
    triggered: market.platform === 'kalshi',
  });

  // Cross-platform listed — same event on both Poly + Kalshi = validated
  // ABSOLUTE: matched or not
  flags.push({
    name: 'cross_platform',
    level: 'high',
    points: TRUST_POINTS.high,
    triggered: !!market.matched_market_id,
  });

  // High volume — top 10% of all markets = strong price discovery
  // PERCENTILE: top 10% adapts to actual data
  flags.push({
    name: 'high_volume',
    level: 'high',
    points: TRUST_POINTS.high,
    triggered: volume >= thresholds.volumeP90,
  });

  // High trader diversity — top 25% of markets by unique wallets
  // PERCENTILE: what counts as "many" adapts to dataset
  flags.push({
    name: 'high_trader_diversity',
    level: 'high',
    points: TRUST_POINTS.high,
    triggered: tradeStats !== null && tradeStats.unique_wallets >= thresholds.uniqueWalletsP75,
  });

  // ---- MEDIUM TRUST (4 pts each) ----

  // Has resolution source — explicit authority for outcome
  // ABSOLUTE: source either exists or not
  flags.push({
    name: 'has_resolution_source',
    level: 'medium',
    points: TRUST_POINTS.medium,
    triggered: !!market.resolution_source,
  });

  // Good volume — top 25-90% range (between p75 and p90)
  // PERCENTILE: "good" volume adapts to actual distribution
  flags.push({
    name: 'good_volume',
    level: 'medium',
    points: TRUST_POINTS.medium,
    triggered: volume >= thresholds.volumeP75 && volume < thresholds.volumeP90,
  });

  // Good liquidity — top 25% of markets
  // PERCENTILE: "good" liquidity adapts to actual distribution
  flags.push({
    name: 'good_liquidity',
    level: 'medium',
    points: TRUST_POINTS.medium,
    triggered: liquidity >= thresholds.liquidityP75,
  });

  // Strong category — verifiable definitive outcomes
  // ABSOLUTE: category is a fact
  flags.push({
    name: 'strong_category',
    level: 'medium',
    points: TRUST_POINTS.medium,
    triggered: category === 'politics' || category === 'sports',
  });

  // Cites official sources in description
  // ABSOLUTE: keyword presence is a fact
  const hasSource = /\b(official|reuters|associated press|bloomberg|government|federal|sec\b|fda\b|cftc|espn|ap news|nba\.com|fifa|announced by|reported by|data from)\b|https?:\/\//.test(description);
  flags.push({
    name: 'cites_sources',
    level: 'medium',
    points: TRUST_POINTS.medium,
    triggered: hasSource,
  });

  // Resolves soon — within 30 days
  // ABSOLUTE: time is absolute
  const endDate = market.end_date ? new Date(market.end_date).getTime() : null;
  flags.push({
    name: 'resolves_soon',
    level: 'medium',
    points: TRUST_POINTS.medium,
    triggered: endDate !== null && (endDate - Date.now()) < 30 * 24 * 60 * 60 * 1000 && (endDate - Date.now()) > 0,
  });

  // ---- LOW TRUST (2 pts each) ----

  // Tight price formation — YES + NO within 2% of 1.00
  // ABSOLUTE: math property
  const priceSum = (parseFloat(market.yes_price) || 0) + (parseFloat(market.no_price) || 0);
  flags.push({
    name: 'tight_price_formation',
    level: 'low',
    points: TRUST_POINTS.low,
    triggered: priceSum > 0 && Math.abs(priceSum - 1) < 0.02,
  });

  // Specific dates/numbers in description or title
  // ABSOLUTE: keyword presence is a fact
  const hasSpecificCriteria = /\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|before|after|by|at least|more than|less than|above|below|\d+%)\b/.test(description) || /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(title);
  flags.push({
    name: 'specific_criteria',
    level: 'low',
    points: TRUST_POINTS.low,
    triggered: hasSpecificCriteria,
  });

  // Mature market — older than 30 days
  // ABSOLUTE: time is absolute
  const createdAt = market.created_at ? new Date(market.created_at).getTime() : Date.now();
  flags.push({
    name: 'mature_market',
    level: 'low',
    points: TRUST_POINTS.low,
    triggered: (Date.now() - createdAt) > 30 * 24 * 60 * 60 * 1000,
  });

  // Polymarket UMA oracle — decentralized resolution mechanism
  // ABSOLUTE: platform property
  flags.push({
    name: 'decentralized_oracle',
    level: 'low',
    points: TRUST_POINTS.low,
    triggered: market.platform === 'polymarket',
  });

  return flags;
}

// =============================================================
// Score Calculator
// =============================================================

function calculateMarketScore(
  market: any,
  tradeStats: { trade_count: number; whale_count: number; unique_wallets: number } | null,
  thresholds: Thresholds
): { score: number; riskFlags: SafetyFlag[]; trustFlags: TrustFlag[]; details: any } {
  const riskFlags = checkRiskFlags(market, tradeStats, thresholds);
  const trustFlags = checkTrustFlags(market, tradeStats, thresholds);

  // Sum up triggered risk points (subtract from 100)
  const totalRiskPoints = riskFlags
    .filter((f) => f.triggered)
    .reduce((sum, f) => sum + f.points, 0);

  // Sum up triggered trust points (add back)
  const totalTrustPoints = trustFlags
    .filter((f) => f.triggered)
    .reduce((sum, f) => sum + f.points, 0);

  // Final score: start at 50 (neutral), subtract risks, add trust
  const score = Math.max(0, Math.min(100, BASELINE_SCORE - totalRiskPoints + totalTrustPoints));

  // Build triggered flag lists for details
  const triggeredRisks = riskFlags
    .filter((f) => f.triggered)
    .map((f) => ({ name: f.name, severity: f.severity, points: f.points }));

  const triggeredTrust = trustFlags
    .filter((f) => f.triggered)
    .map((f) => ({ name: f.name, level: f.level, points: f.points }));

  return {
    score,
    riskFlags,
    trustFlags,
    details: {
      risk_points: totalRiskPoints,
      trust_points: totalTrustPoints,
      risk_flags: triggeredRisks,
      trust_flags: triggeredTrust,
      risk_count: triggeredRisks.length,
      trust_count: triggeredTrust.length,
    },
  };
}

/** Batch size for UPDATE queries — keeps each query under ~1MB */
const UPDATE_BATCH_SIZE = 500;

/**
 * Main Safety Score calculation — called by BullMQ every 10 minutes.
 *
 * GMGN-style approach:
 * 1. Fetch all active markets with volume > 0
 * 2. Batch-fetch trade stats for all markets
 * 3. For each market: check risk flags + trust flags → compute score
 * 4. Batch UPDATE markets table
 * 5. Batch INSERT into history
 */
export async function calculateSafetyScores(): Promise<void> {
  log.info('Starting Market Safety Score calculation...');
  const startTime = Date.now();

  try {
    // Step 1: Get all active markets with volume > 0
    const marketsResult = await db.query(`
      SELECT id, platform, platform_id, title, description, category,
             status, yes_price, no_price, volume, liquidity,
             resolution_source, end_date, matched_market_id, created_at
      FROM markets
      WHERE status = 'active'
        AND volume > 0
      ORDER BY volume DESC
    `);

    const markets = marketsResult.rows;
    log.info({ marketCount: markets.length }, 'Scoring active markets with volume');

    // Step 2: Batch-fetch trade stats for ALL markets in one query
    const tradeStatsResult = await db.query(`
      SELECT
        market_id,
        COUNT(*) AS trade_count,
        COUNT(*) FILTER (WHERE is_whale = true) AS whale_count,
        COUNT(DISTINCT wallet_address) AS unique_wallets
      FROM trades
      WHERE market_id IS NOT NULL
      GROUP BY market_id
    `);

    const tradeStatsMap = new Map<string, { trade_count: number; whale_count: number; unique_wallets: number }>();
    for (const row of tradeStatsResult.rows) {
      tradeStatsMap.set(row.market_id, {
        trade_count: parseInt(row.trade_count) || 0,
        whale_count: parseInt(row.whale_count) || 0,
        unique_wallets: parseInt(row.unique_wallets) || 0,
      });
    }

    // Step 3: Build percentile thresholds from actual data distribution
    // Computed once here, used for every market's flag checks below.
    const allVolumes = markets.map((m: any) => parseFloat(m.volume) || 0);
    const allLiquidity = markets.map((m: any) => parseFloat(m.liquidity) || 0);
    const allTradeCounts: number[] = [];
    const allUniqueWallets: number[] = [];
    for (const stats of tradeStatsMap.values()) {
      allTradeCounts.push(stats.trade_count);
      allUniqueWallets.push(stats.unique_wallets);
    }
    const thresholds = buildThresholds(allVolumes, allLiquidity, allTradeCounts, allUniqueWallets);
    log.debug({
      volumeP10: thresholds.volumeP10.toFixed(0),
      volumeP90: thresholds.volumeP90.toFixed(0),
      liquidityP05: thresholds.liquidityP05.toFixed(0),
      liquidityP75: thresholds.liquidityP75.toFixed(0),
      tradeCountP25: thresholds.tradeCountP25,
      uniqueWalletsP75: thresholds.uniqueWalletsP75,
    }, 'Percentile thresholds computed');

    // Step 4: Calculate scores for all markets
    const scoredMarkets: Array<{
      id: string;
      overallScore: number;
      details: string;
    }> = [];

    for (const market of markets) {
      const tradeStats = tradeStatsMap.get(market.id) || null;
      const result = calculateMarketScore(market, tradeStats, thresholds);

      scoredMarkets.push({
        id: market.id,
        overallScore: result.score,
        details: JSON.stringify(result.details),
      });
    }

    // Step 5: Batch UPDATE markets table
    for (let i = 0; i < scoredMarkets.length; i += UPDATE_BATCH_SIZE) {
      const batch = scoredMarkets.slice(i, i + UPDATE_BATCH_SIZE);

      const values: any[] = [];
      const valuePlaceholders: string[] = [];
      for (let j = 0; j < batch.length; j++) {
        const offset = j * 3;
        valuePlaceholders.push(`($${offset + 1}::uuid, $${offset + 2}::integer, $${offset + 3}::jsonb)`);
        values.push(batch[j].id, batch[j].overallScore, batch[j].details);
      }

      await db.query(`
        UPDATE markets AS m
        SET safety_score = v.score,
            safety_details = v.details,
            updated_at = NOW()
        FROM (VALUES ${valuePlaceholders.join(',')}) AS v(id, score, details)
        WHERE m.id = v.id
      `, values);

      if ((i + UPDATE_BATCH_SIZE) % 5000 < UPDATE_BATCH_SIZE) {
        log.debug({ updated: Math.min(i + UPDATE_BATCH_SIZE, scoredMarkets.length), total: scoredMarkets.length }, 'Safety score UPDATE progress');
      }
    }

    // Step 5: Batch INSERT into history table
    // The table has 4 component columns from the old schema. We repurpose them:
    //   liquidity_score → risk_points (total risk deductions)
    //   resolution_score → trust_points (total trust additions)
    //   manipulation_score → risk_flag_count (how many risk flags triggered)
    //   structural_score → trust_flag_count (how many trust flags triggered)
    for (let i = 0; i < scoredMarkets.length; i += UPDATE_BATCH_SIZE) {
      const batch = scoredMarkets.slice(i, i + UPDATE_BATCH_SIZE);

      const values: any[] = [];
      const valuePlaceholders: string[] = [];
      for (let j = 0; j < batch.length; j++) {
        const offset = j * 7;
        const details = JSON.parse(batch[j].details);
        valuePlaceholders.push(
          `($${offset + 1}::uuid, $${offset + 2}::integer, $${offset + 3}::integer, $${offset + 4}::integer, $${offset + 5}::integer, $${offset + 6}::integer, $${offset + 7}::jsonb, NOW())`
        );
        values.push(
          batch[j].id,
          batch[j].overallScore,
          details.risk_points || 0,
          details.trust_points || 0,
          details.risk_count || 0,
          details.trust_count || 0,
          batch[j].details,
        );
      }

      await db.query(`
        INSERT INTO market_safety_scores (
          market_id, overall_score,
          liquidity_score, resolution_score,
          manipulation_score, structural_score,
          details, calculated_at
        ) VALUES ${valuePlaceholders.join(',')}
      `, values);
    }

    const duration = Date.now() - startTime;
    log.info(
      { marketsScored: scoredMarkets.length, durationMs: duration },
      'Market Safety Score calculation complete'
    );
  } catch (err) {
    log.error({ err }, 'Market Safety Score calculation failed');
    throw err;
  }
}
