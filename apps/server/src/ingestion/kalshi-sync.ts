// =============================================================
// Kalshi Market Sync (REST API)
// =============================================================
//
// WHAT: Fetches all active markets from Kalshi and stores them
//       in our unified markets table alongside Polymarket markets.
//
// WHY:  Kalshi is the only CFTC-regulated prediction market in the US.
//       By integrating both platforms, we enable:
//       - Cross-platform arbitrage detection (same event, different prices)
//       - Combined volume analysis (total market interest)
//       - Market Safety Score improvement (more data sources = better score)
//       - Market discovery (events unique to Kalshi)
//
// KALSHI vs POLYMARKET (key differences):
//       - Kalshi is CENTRALIZED — no blockchain, no wallets, no transparency
//       - Trades are anonymous — we CANNOT do smart money tracking on Kalshi
//       - Kalshi uses USD directly (FDIC insured), not crypto
//       - Kalshi has fees of 1-5.6% (vs Polymarket's ~1% + gas)
//       - Kalshi uses "ticker" IDs (e.g., "PRES-2024-DEM") not hashes
//
// API:  Kalshi Trade API v2
//       Base: https://api.elections.kalshi.com/trade-api/v2
//       GET /events — Event groups (paginated)
//       GET /markets — Individual markets (paginated)
//       No authentication required for read-only endpoints.
//
// HOW:  Runs every 5 minutes via BullMQ.
//       1. Fetch all active events from Kalshi
//       2. Fetch markets for each event
//       3. Upsert into our unified markets table (platform='kalshi')
//       4. Store Kalshi-specific data (ticker, subtitle, rules)
//
// PAGINATION:
//       Kalshi uses cursor-based pagination.
//       Response includes a `cursor` field — pass it as query param
//       to get the next page. Empty cursor = no more pages.
//
// DOCS: https://trading-api.readme.io/reference/getmarkets
// =============================================================

import { db } from '../db/postgres';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('kalshi-sync');

// ---- Kalshi API Response Types ----
// These match the actual Kalshi API response structure.

interface KalshiEvent {
  event_ticker: string;        // e.g., "PRES-2024"
  series_ticker: string;       // e.g., "PRES"
  title: string;               // e.g., "2024 Presidential Election"
  category: string;            // e.g., "Politics"
  mutually_exclusive: boolean; // Are markets within this event exclusive?
  markets: KalshiMarket[];     // Markets within this event (if expanded)
}

interface KalshiMarket {
  ticker: string;              // e.g., "PRES-2024-DEM" — unique market ID
  event_ticker: string;        // Parent event ticker
  title: string;               // e.g., "Will a Democrat win the 2024 Presidential Election?"
  subtitle?: string;           // Additional context
  status: string;              // "active", "closed", "settled"
  yes_bid: number;             // Best bid for YES (in cents, 0-100)
  yes_ask: number;             // Best ask for YES (in cents, 0-100)
  no_bid: number;              // Best bid for NO
  no_ask: number;              // Best ask for NO
  last_price: number;          // Last trade price (cents)
  volume: number;              // Total contracts traded
  volume_24h: number;          // Contracts traded in last 24h
  open_interest: number;       // Currently open contracts
  close_time: string;          // ISO timestamp when market closes
  expiration_time: string;     // ISO timestamp when market expires
  result?: string;             // "yes" or "no" (after settlement)
  rules_primary?: string;      // Resolution rules text
  category?: string;           // Market category
}

/**
 * Fetches all active markets from Kalshi REST API.
 *
 * The Kalshi API has two main endpoints:
 *   - GET /events: Returns event groups with metadata
 *   - GET /markets: Returns individual markets (can filter by status)
 *
 * We use /markets directly since it gives us everything we need
 * in a flat list. Cursor-based pagination fetches all pages.
 *
 * Kalshi prices are in CENTS (0-100), not dollars.
 * A "yes_bid" of 35 means the YES token costs $0.35.
 * We convert to decimal (0-1) to match our unified schema.
 */
async function fetchKalshiMarkets(): Promise<KalshiMarket[]> {
  const allMarkets: KalshiMarket[] = [];
  let cursor: string | undefined;

  while (true) {
    // Build URL with query parameters
    // status=open: only fetch active markets (not settled/closed)
    // limit=200: max per page (Kalshi's maximum)
    let url = `${env.KALSHI_API}/markets?limit=200&status=open`;

    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    log.debug({ url }, 'Fetching Kalshi markets page');

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    // Kalshi wraps markets in a "markets" array
    const markets: KalshiMarket[] = data.markets || [];

    if (markets.length === 0) break;

    allMarkets.push(...markets);

    // Cursor-based pagination: empty cursor means no more pages
    cursor = data.cursor;
    if (!cursor) break;

    // Delay between pages to avoid Kalshi 429 rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return allMarkets;
}

/**
 * Maps Kalshi categories to our unified category system.
 *
 * Kalshi uses its own category names (e.g., "Politics", "Economics").
 * We normalize these to our standard categories defined in
 * packages/shared/src/constants.ts.
 *
 * Why normalize? So the frontend can filter markets by category
 * across both platforms using a single dropdown.
 */
function normalizeCategory(kalshiCategory: string | undefined): string {
  if (!kalshiCategory) return 'other';

  const cat = kalshiCategory.toLowerCase();

  // Map Kalshi categories to our unified categories
  if (cat.includes('politic') || cat.includes('election') || cat.includes('congress')) {
    return 'politics';
  }
  if (cat.includes('econom') || cat.includes('fed') || cat.includes('gdp') || cat.includes('inflation') || cat.includes('financ')) {
    return 'economics';
  }
  if (cat.includes('crypto') || cat.includes('bitcoin') || cat.includes('ethereum')) {
    return 'crypto';
  }
  if (cat.includes('sport') || cat.includes('nfl') || cat.includes('nba') || cat.includes('mlb')) {
    return 'sports';
  }
  if (cat.includes('entertainment') || cat.includes('oscar') || cat.includes('grammy')) {
    return 'entertainment';
  }
  if (cat.includes('science') || cat.includes('space') || cat.includes('climate') || cat.includes('weather')) {
    return 'science';
  }
  if (cat.includes('tech') || cat.includes('ai') || cat.includes('company')) {
    return 'technology';
  }
  if (cat.includes('world') || cat.includes('international') || cat.includes('geopolit')) {
    return 'world';
  }

  return 'other';
}

/**
 * Upserts a Kalshi market into our unified markets table.
 *
 * Key differences from Polymarket upsert:
 * - platform = 'kalshi' (not 'polymarket')
 * - platform_id = ticker (e.g., "PRES-2024-DEM"), not a condition_id hash
 * - Prices are converted from cents (0-100) to decimal (0-1)
 * - No token_id or condition_id fields (those are Polymarket-specific)
 * - volume is in contracts, not USDC
 *
 * ON CONFLICT: If we already have this market (same platform + platform_id),
 * update the prices, volume, and status. This keeps data fresh.
 */
async function upsertMarket(market: KalshiMarket): Promise<{ isNew: boolean }> {
  // Convert cents (0-100) to decimal (0-1) for unified schema
  // Kalshi's last_price is in cents: 35 = $0.35
  // If no last_price, use midpoint of bid/ask
  const yesPrice = market.last_price
    ? market.last_price / 100
    : market.yes_bid
      ? (market.yes_bid + market.yes_ask) / 200
      : 0.5;

  const noPrice = 1 - yesPrice; // YES + NO always = $1.00

  // Map Kalshi status to our unified status
  const status = market.status === 'active' || market.status === 'open'
    ? 'active'
    : market.status === 'settled'
      ? 'resolved'
      : 'closed';

  const result = await db.query(
    `INSERT INTO markets (
      platform, platform_id, title, category,
      yes_price, no_price, volume, status, end_date
    ) VALUES (
      'kalshi', $1, $2, $3,
      $4, $5, $6, $7, $8
    )
    ON CONFLICT (platform, platform_id) DO UPDATE SET
      title = EXCLUDED.title,
      yes_price = EXCLUDED.yes_price,
      no_price = EXCLUDED.no_price,
      volume = EXCLUDED.volume,
      status = EXCLUDED.status,
      end_date = EXCLUDED.end_date,
      updated_at = NOW()
    RETURNING (xmax = 0) AS is_new`,
    [
      market.ticker,                                          // $1: platform_id
      market.title,                                           // $2: title
      normalizeCategory(market.category),                     // $3: category
      yesPrice,                                               // $4: yes_price
      noPrice,                                                // $5: no_price
      market.volume || 0,                                     // $6: volume
      status,                                                 // $7: status
      market.close_time || market.expiration_time || null,     // $8: end_date
    ]
  );

  return { isNew: result.rows[0]?.is_new === true };
}

/**
 * Main Kalshi sync function — called by BullMQ every 5 minutes.
 *
 * Flow:
 * 1. Fetch all active markets from Kalshi REST API
 * 2. For each market: upsert into our unified markets table
 * 3. Log counts of new vs updated markets
 *
 * Why every 5 minutes?
 * - Kalshi markets don't change as frequently as Polymarket
 * - 5 minutes is fast enough for arbitrage detection
 * - Avoids unnecessary API load on Kalshi's servers
 * - Matches our Polymarket sync interval for consistency
 */
export async function syncKalshiMarkets(): Promise<void> {
  log.info('Starting Kalshi market sync...');
  const startTime = Date.now();

  try {
    const markets = await fetchKalshiMarkets();

    let newCount = 0;
    let updatedCount = 0;

    for (const market of markets) {
      const { isNew } = await upsertMarket(market);
      if (isNew) {
        newCount++;
      } else {
        updatedCount++;
      }
    }

    const duration = Date.now() - startTime;
    log.info(
      { total: markets.length, new: newCount, updated: updatedCount, durationMs: duration },
      'Kalshi market sync complete'
    );
  } catch (err) {
    log.error({ err }, 'Kalshi market sync failed');
    throw err; // BullMQ handles retry
  }
}
