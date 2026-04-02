// =============================================================
// Cross-Platform Market Matcher + Arbitrage Detector
// =============================================================
//
// WHAT: Finds the same prediction market on both Polymarket and
//       Kalshi, links them via matched_market_id, and detects
//       arbitrage opportunities when prices diverge.
//
// MATCHING STRATEGY (multi-stage, no hardcoded scores):
//
//   Stage 1: Category filter
//     - Both markets must be in the same category (or both uncategorized)
//
//   Stage 2: End date proximity
//     - Markets must resolve within 14 days of each other
//     - Markets with no end_date are skipped (can't verify same event)
//
//   Stage 3: Entity extraction
//     - Extract proper nouns, numbers, percentages, dates from titles
//     - ALL entities from the shorter title must appear in the longer one
//     - This prevents false matches like "Trump wins by 5%" vs "Trump wins"
//
//   Stage 4: Token similarity (Jaccard)
//     - After entity validation, compute token overlap
//     - Threshold: 0.55 (55% overlap required)
//     - Uses normalized tokens (lowercase, no stop words)
//
// ARBITRAGE DETECTION:
//   If YES_A + NO_B < $1.00, buying both guarantees profit.
//   Only flagged when spread > 2% AND both markets have volume > $1000.
//
// PERFORMANCE:
//   Only matches active markets with volume > 0.
//   Polymarket markets: ~5K active. Kalshi: ~3K active.
//   For each Polymarket market, only compares against same-category
//   Kalshi markets with close end dates — typically <100 comparisons.
// =============================================================

import { db } from '../db/postgres';
import { createLogger } from '../utils/logger';
import { sendArbitrageAlert } from '../alerts/telegram';

const log = createLogger('market-matcher');

// =============================================================
// Text Normalization
// =============================================================

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'will', 'be', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'or', 'and', 'not', 'no', 'yes', 'do', 'does', 'did',
  'this', 'that', 'it', 'its', 'if', 'than', 'then',
  'before', 'after', 'during', 'between', 'through',
  'have', 'has', 'had', 'been', 'being',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where',
  'any', 'all', 'each', 'every', 'both', 'more', 'most',
]);

/**
 * Normalize a market title into comparable tokens.
 * Strips punctuation, lowercases, removes stop words.
 */
function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/['']/g, "'")       // normalize quotes
    .replace(/[^a-z0-9'%$.+-]/g, ' ')  // keep numbers, %, $, decimals
    .split(/\s+/)
    .filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

// =============================================================
// Entity Extraction
// =============================================================

/**
 * Extract "entities" from a market title:
 * - Numbers with units: "50+", "25%", "$100", "2.5"
 * - Dates: "march 2026", "2026-03-10", "january", etc.
 * - Proper nouns / key terms: multi-char tokens that aren't stop words
 *
 * Returns lowercase entities for comparison.
 */
function extractEntities(title: string): Set<string> {
  const entities = new Set<string>();
  const lower = title.toLowerCase();

  // Extract percentages: "50%", "25+ bps", "2.5%"
  const pctMatches = lower.match(/\d+\.?\d*\s*(%|bps|percent|basis\s*points?)/g);
  if (pctMatches) {
    for (const m of pctMatches) {
      // Normalize to just the number
      const num = m.match(/\d+\.?\d*/)?.[0];
      if (num) entities.add(num);
    }
  }

  // Extract dollar amounts: "$100", "$1.5M"
  const dollarMatches = lower.match(/\$\d+\.?\d*[kmb]?/g);
  if (dollarMatches) {
    for (const m of dollarMatches) entities.add(m);
  }

  // Extract standalone numbers that likely matter (thresholds, scores, etc.)
  const numberMatches = lower.match(/\b\d+\.?\d*\b/g);
  if (numberMatches) {
    for (const n of numberMatches) {
      // Skip very common numbers that aren't meaningful (like "2026" year is kept)
      if (parseFloat(n) > 0) entities.add(n);
    }
  }

  // Extract month names (important for "by March" vs "by June")
  const months = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  for (const month of months) {
    if (lower.includes(month)) {
      entities.add(month.length <= 3 ? month : month.slice(0, 3)); // normalize to 3-letter
    }
  }

  // Extract key proper nouns: capitalized words from ORIGINAL title
  // These are names (Trump, Fed, Bayern, Chelsea) that must match
  const properNouns = title.match(/\b[A-Z][a-z]{2,}\b/g);
  if (properNouns) {
    for (const noun of properNouns) {
      const l = noun.toLowerCase();
      if (!STOP_WORDS.has(l) && l.length > 2) {
        entities.add(l);
      }
    }
  }

  return entities;
}

// =============================================================
// Similarity Calculation
// =============================================================

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|
 * Returns 0.0 to 1.0
 */
function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check that entities from BOTH titles match each other.
 * This prevents false matches like:
 *   "Brex IPO before 2027?" vs "Who will IPO before 2027?"
 *   (Brex has entity "brex" that the generic question doesn't)
 *
 * Rules:
 * 1. Both must have at least 1 entity (skip vague titles)
 * 2. All proper nouns from EACH side must appear in the other
 * 3. All numbers/percentages from EACH side must appear in the other
 */
function entitiesMatch(entitiesA: Set<string>, entitiesB: Set<string>): boolean {
  // Both must have entities — skip vague titles
  if (entitiesA.size === 0 || entitiesB.size === 0) return false;

  // Every entity from A must be in B
  for (const entity of entitiesA) {
    if (!entitiesB.has(entity)) return false;
  }

  // Every entity from B must be in A
  for (const entity of entitiesB) {
    if (!entitiesA.has(entity)) return false;
  }

  return true;
}

// =============================================================
// Date Proximity Check
// =============================================================

const MAX_DATE_DIFF_DAYS = 14;

function datesAreClose(dateA: Date | null, dateB: Date | null): boolean {
  if (!dateA || !dateB) return false;

  const diffMs = Math.abs(dateA.getTime() - dateB.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays <= MAX_DATE_DIFF_DAYS;
}

// =============================================================
// Arbitrage Detection
// =============================================================

const MIN_ARB_SPREAD_PCT = 2;   // Only flag spreads > 2%
const MIN_ARB_VOLUME = 1000;     // Both markets must have > $1K volume

interface ArbOpportunity {
  marketAId: string;
  marketBId: string;
  priceA: number;       // YES price on platform A
  priceB: number;       // YES price on platform B
  spread: number;       // absolute price difference
  spreadPct: number;    // spread as percentage
}

/**
 * Check if two matched markets have an arbitrage opportunity.
 *
 * Arb exists when: buy YES on cheaper + buy NO on expensive < $1.00
 * Example: YES=0.40 on Poly, YES=0.50 on Kalshi
 *   → buy YES on Poly (0.40) + buy NO on Kalshi (0.50) = 0.90
 *   → guaranteed $1.00 payout → 10% profit
 */
function detectArbitrage(
  yesA: number, noA: number, volA: number,
  yesB: number, noB: number, volB: number,
  idA: string, idB: string
): ArbOpportunity | null {
  // Both markets need meaningful volume
  if (volA < MIN_ARB_VOLUME || volB < MIN_ARB_VOLUME) return null;

  // Skip markets with invalid prices
  if (yesA <= 0 || yesB <= 0 || yesA >= 1 || yesB >= 1) return null;

  // Check both arb directions:
  // Direction 1: buy YES on A + buy NO on B
  const cost1 = yesA + (1 - yesB); // YES_A + NO_B
  // Direction 2: buy YES on B + buy NO on A
  const cost2 = yesB + (1 - yesA); // YES_B + NO_A

  // The cheaper combo is the arb
  const bestCost = Math.min(cost1, cost2);
  const spread = 1 - bestCost; // profit per $1 deployed

  if (spread <= 0) return null;

  const spreadPct = spread * 100;
  if (spreadPct < MIN_ARB_SPREAD_PCT) return null;

  return {
    marketAId: idA,
    marketBId: idB,
    priceA: yesA,
    priceB: yesB,
    spread: Math.round(spread * 10000) / 10000,
    spreadPct: Math.round(spreadPct * 100) / 100,
  };
}

// =============================================================
// Main Matching Function
// =============================================================

interface MarketRow {
  id: string;
  platform: string;
  title: string;
  category: string | null;
  status: string;
  yes_price: string | null;
  no_price: string | null;
  volume: string;
  end_date: Date | null;
}

const JACCARD_THRESHOLD = 0.55;

export async function matchMarkets(): Promise<void> {
  log.info('Starting cross-platform market matching...');

  // Fetch active markets with volume from both platforms
  const polyResult = await db.query<MarketRow>(
    `SELECT id, platform, title, category, status, yes_price, no_price, volume, end_date
     FROM markets
     WHERE platform = 'polymarket'
       AND status = 'active'
       AND volume > 0
       AND title IS NOT NULL
       AND end_date IS NOT NULL
     ORDER BY volume DESC
     LIMIT 5000`
  );

  const kalshiResult = await db.query<MarketRow>(
    `SELECT id, platform, title, category, status, yes_price, no_price, volume, end_date
     FROM markets
     WHERE platform = 'kalshi'
       AND status = 'active'
       AND volume > 0
       AND title IS NOT NULL
       AND end_date IS NOT NULL
     ORDER BY volume DESC
     LIMIT 5000`
  );

  const polyMarkets = polyResult.rows;
  const kalshiMarkets = kalshiResult.rows;

  log.info({ polymarket: polyMarkets.length, kalshi: kalshiMarkets.length },
    'Active markets loaded for matching');

  if (polyMarkets.length === 0 || kalshiMarkets.length === 0) {
    log.info('No markets to match (one platform has zero active markets)');
    return;
  }

  // Group Kalshi markets by category for faster lookup
  const kalshiByCategory = new Map<string, MarketRow[]>();
  for (const km of kalshiMarkets) {
    const cat = km.category || 'other';
    if (!kalshiByCategory.has(cat)) kalshiByCategory.set(cat, []);
    kalshiByCategory.get(cat)!.push(km);
  }

  // Also keep a flat list for uncategorized matching
  const kalshiUncategorized = kalshiMarkets.filter(m => !m.category || m.category === 'other');

  let matchCount = 0;
  let arbCount = 0;
  const matchedPairs: { polyId: string; kalshiId: string; similarity: number }[] = [];
  const arbOpportunities: ArbOpportunity[] = [];

  // Pre-compute tokens + entities for all Kalshi markets
  const kalshiProcessed = new Map<string, { tokens: string[]; entities: Set<string> }>();
  for (const km of kalshiMarkets) {
    kalshiProcessed.set(km.id, {
      tokens: tokenize(km.title),
      entities: extractEntities(km.title),
    });
  }

  for (const pm of polyMarkets) {
    const pmTokens = tokenize(pm.title);
    const pmEntities = extractEntities(pm.title);

    // Stage 1: Get candidate Kalshi markets from same category
    const pmCat = pm.category || 'other';
    let candidates = kalshiByCategory.get(pmCat) || [];

    // Also check uncategorized if this market's category is specific
    if (pmCat !== 'other') {
      candidates = [...candidates, ...kalshiUncategorized];
    }

    // Deduplicate candidates
    const seen = new Set<string>();
    candidates = candidates.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    let bestMatch: { market: MarketRow; similarity: number } | null = null;

    for (const km of candidates) {
      // Stage 2: End date proximity check
      if (!datesAreClose(pm.end_date, km.end_date)) continue;

      const kmData = kalshiProcessed.get(km.id)!;

      // Stage 3: Entity match — all entities from shorter must be in longer
      if (!entitiesMatch(pmEntities, kmData.entities)) continue;

      // Stage 4: Token similarity
      const similarity = jaccardSimilarity(pmTokens, kmData.tokens);
      if (similarity < JACCARD_THRESHOLD) continue;

      // Keep best match
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { market: km, similarity };
      }
    }

    if (bestMatch) {
      matchedPairs.push({
        polyId: pm.id,
        kalshiId: bestMatch.market.id,
        similarity: bestMatch.similarity,
      });
      matchCount++;

      // Check for arbitrage
      const arb = detectArbitrage(
        parseFloat(pm.yes_price || '0'),
        parseFloat(pm.no_price || '0'),
        parseFloat(pm.volume),
        parseFloat(bestMatch.market.yes_price || '0'),
        parseFloat(bestMatch.market.no_price || '0'),
        parseFloat(bestMatch.market.volume),
        pm.id,
        bestMatch.market.id,
      );

      if (arb) {
        arbOpportunities.push(arb);
        arbCount++;
      }
    }
  }

  log.info({ matchCount, arbCount }, 'Matching complete');

  // ---- Write results to DB ----

  if (matchedPairs.length > 0) {
    // Clear old matched_market_id links first
    await db.query(
      `UPDATE markets SET matched_market_id = NULL
       WHERE matched_market_id IS NOT NULL`
    );

    // Write new links (both directions)
    for (const pair of matchedPairs) {
      await db.query(
        `UPDATE markets SET matched_market_id = $1 WHERE id = $2`,
        [pair.kalshiId, pair.polyId]
      );
      await db.query(
        `UPDATE markets SET matched_market_id = $1 WHERE id = $2`,
        [pair.polyId, pair.kalshiId]
      );
    }

    log.info({ pairs: matchedPairs.length }, 'Market links updated');

    // Log top matches for debugging
    const topMatches = matchedPairs
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
    for (const m of topMatches) {
      const poly = polyMarkets.find(p => p.id === m.polyId);
      const kalshi = kalshiMarkets.find(k => k.id === m.kalshiId);
      if (poly && kalshi) {
        log.info({
          similarity: Math.round(m.similarity * 100) + '%',
          polymarket: poly.title.slice(0, 60),
          kalshi: kalshi.title.slice(0, 60),
        }, 'Matched pair');
      }
    }
  }

  // ---- Write arbitrage opportunities ----

  if (arbOpportunities.length > 0) {
    // Expire old opportunities
    await db.query(
      `UPDATE arbitrage_opportunities
       SET expired_at = NOW()
       WHERE expired_at IS NULL`
    );

    // Insert new opportunities
    for (const arb of arbOpportunities) {
      await db.query(
        `INSERT INTO arbitrage_opportunities
           (market_a_id, market_b_id, price_a, price_b, spread, spread_pct)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [arb.marketAId, arb.marketBId, arb.priceA, arb.priceB, arb.spread, arb.spreadPct]
      );
    }

    log.info({ count: arbOpportunities.length }, 'Arbitrage opportunities stored');

    // Log top arbs + send Telegram alerts
    const topArbs = arbOpportunities
      .sort((a, b) => b.spreadPct - a.spreadPct)
      .slice(0, 5);
    for (const arb of topArbs) {
      const poly = polyMarkets.find(p => p.id === arb.marketAId);
      const kalshi = kalshiMarkets.find(k => k.id === arb.marketBId);
      log.info({
        spreadPct: arb.spreadPct + '%',
        polymarket: poly?.title?.slice(0, 50),
        kalshi: kalshi?.title?.slice(0, 50),
        priceA: arb.priceA,
        priceB: arb.priceB,
      }, 'Arbitrage opportunity');

      // Send Telegram alert for top arbitrage opportunities
      if (poly && kalshi) {
        sendArbitrageAlert({
          polymarketTitle: poly.title,
          kalshiTitle: kalshi.title,
          polyPrice: arb.priceA,
          kalshiPrice: arb.priceB,
          spreadPct: arb.spreadPct,
          polyVolume: parseFloat(poly.volume),
          kalshiVolume: parseFloat(kalshi.volume),
        }).catch(err => log.error({ err }, 'Telegram arbitrage alert failed'));
      }
    }
  }
}
