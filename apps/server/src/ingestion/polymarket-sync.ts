// =============================================================
// Polymarket Market Sync (Gamma API)
// =============================================================
//
// WHAT: Fetches all active prediction markets from Polymarket
//       and stores/updates them in our PostgreSQL database.
//
// WHY:  This is how we know what markets exist. Without this,
//       we have nothing to show on the dashboard.
//
// API:  Polymarket Gamma API (https://gamma-api.polymarket.com)
//       - No authentication required
//       - Returns events (groups of markets) and individual markets
//       - Each market has: title, prices, volume, category, etc.
//
// HOW:  Runs every 5 minutes via BullMQ repeatable job.
//       1. Fetch all active events from GET /events
//       2. For each market in each event: UPSERT into our markets table
//       3. "Upsert" means: insert if new, update if it already exists
//
// DOCS: https://docs.polymarket.com/#get-markets
//       https://docs.polymarket.com/#get-events
// =============================================================

import { db } from '../db/postgres';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';
import type { PolymarketGammaEvent, PolymarketGammaMarket } from '@markypie/shared';

const log = createLogger('polymarket-sync');

/**
 * Fetches events from Polymarket Gamma API.
 *
 * The Gamma API paginates results. We use `limit` and `offset`
 * to fetch all events. Each event contains an array of markets.
 *
 * Example response:
 * [
 *   {
 *     id: "12345",
 *     title: "2026 Federal Reserve Meetings",
 *     category: "economics",
 *     markets: [
 *       { condition_id: "0xabc...", question: "Fed cuts March 2026?", ... },
 *       { condition_id: "0xdef...", question: "Fed cuts June 2026?", ... }
 *     ]
 *   }
 * ]
 */
async function fetchEvents(): Promise<PolymarketGammaEvent[]> {
  const allEvents: PolymarketGammaEvent[] = [];
  let offset = 0;
  const limit = 100; // Gamma API max per page

  while (true) {
    const url = `${env.POLYMARKET_GAMMA_API}/events?active=true&closed=false&limit=${limit}&offset=${offset}`;
    log.debug({ url, offset }, 'Fetching events page');

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
    }

    const events = (await response.json()) as PolymarketGammaEvent[];

    if (events.length === 0) break; // No more pages

    allEvents.push(...events);
    offset += limit;

    // Safety: don't fetch more than 50,000 events (currently ~7,500 active)
    if (offset > 50000) break;
  }

  return allEvents;
}

/**
 * Maps a Polymarket category string to our normalized categories.
 * Polymarket uses various category strings; we normalize them.
 */
function normalizeCategory(category: string | undefined): string {
  if (!category) return 'other';

  const lower = category.toLowerCase();

  if (lower.includes('politic') || lower.includes('election')) return 'politics';
  if (lower.includes('econom') || lower.includes('fed') || lower.includes('finance')) return 'economics';
  if (lower.includes('crypto') || lower.includes('bitcoin') || lower.includes('ethereum')) return 'crypto';
  if (lower.includes('sport') || lower.includes('nba') || lower.includes('nfl') || lower.includes('soccer')) return 'sports';
  if (lower.includes('entertain') || lower.includes('oscar') || lower.includes('grammy')) return 'entertainment';
  if (lower.includes('tech')) return 'technology';
  if (lower.includes('science') || lower.includes('climate') || lower.includes('weather')) return 'science';

  return 'other';
}

/**
 * Upserts a single market into our database.
 *
 * "UPSERT" = INSERT ... ON CONFLICT ... DO UPDATE
 * If the market doesn't exist yet (new condition_id), INSERT it.
 * If it already exists, UPDATE the prices, volume, liquidity, etc.
 *
 * This is idempotent — running it twice with the same data
 * produces the same result. Important for reliability.
 */
async function upsertMarket(
  market: PolymarketGammaMarket,
  eventCategory: string
): Promise<void> {
  // Parse YES and NO prices from outcomePrices JSON string
  // API returns: outcomePrices: '["0.35", "0.65"]', outcomes: '["Yes", "No"]'
  let yesPrice: number | null = null;
  let noPrice: number | null = null;

  try {
    if (market.outcomePrices) {
      const prices = JSON.parse(market.outcomePrices) as string[];
      const outcomes = market.outcomes ? (JSON.parse(market.outcomes) as string[]) : ['Yes', 'No'];
      const yesIdx = outcomes.findIndex((o) => o === 'Yes');
      const noIdx = outcomes.findIndex((o) => o === 'No');
      if (yesIdx !== -1 && prices[yesIdx]) yesPrice = parseFloat(prices[yesIdx]);
      if (noIdx !== -1 && prices[noIdx]) noPrice = parseFloat(prices[noIdx]);
    }
  } catch {
    // Fallback to lastTradePrice if JSON parsing fails
    if (market.lastTradePrice != null) {
      yesPrice = market.lastTradePrice;
      noPrice = 1 - market.lastTradePrice;
    }
  }

  // Parse token IDs from clobTokenIds JSON string
  // These are the ERC-1155 token IDs needed for WebSocket subscriptions
  let tokenIds: string[] | null = null;
  try {
    if (market.clobTokenIds) {
      tokenIds = JSON.parse(market.clobTokenIds) as string[];
    }
  } catch {
    // Ignore parse errors
  }

  await db.query(
    `INSERT INTO markets (
      platform, platform_id, title, description, category, status,
      yes_price, no_price, volume, liquidity, end_date, token_ids, updated_at
    ) VALUES (
      'polymarket', $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11, NOW()
    )
    ON CONFLICT (platform, platform_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      category = EXCLUDED.category,
      status = EXCLUDED.status,
      yes_price = EXCLUDED.yes_price,
      no_price = EXCLUDED.no_price,
      volume = EXCLUDED.volume,
      liquidity = EXCLUDED.liquidity,
      end_date = EXCLUDED.end_date,
      token_ids = COALESCE(EXCLUDED.token_ids, markets.token_ids),
      updated_at = NOW()`,
    [
      market.conditionId,                                     // $1: platform_id (camelCase from API)
      market.question,                                        // $2: title
      market.description || null,                             // $3: description
      normalizeCategory(eventCategory || market.category),    // $4: category
      market.closed ? 'closed' : (market.active ? 'active' : 'closed'), // $5: status
      yesPrice,                                               // $6: yes_price
      noPrice,                                                // $7: no_price
      market.volumeNum || parseFloat(market.volume) || 0,     // $8: volume (prefer numeric)
      market.liquidityNum || 0,                               // $9: liquidity
      market.endDate || market.endDateIso || null,             // $10: end_date (camelCase)
      tokenIds,                                               // $11: token_ids (for WebSocket)
    ]
  );
}

/**
 * Syncs ALL closed/resolved markets from Gamma API.
 * This is a one-time backfill — runs once on first startup when
 * no resolved markets exist in the DB. Takes ~15-20 minutes.
 *
 * Why? Top traders made money on 2024 election markets which are
 * now resolved. Without these, trade enrichment can't link trades
 * to markets (0% match rate for historical trades).
 */
export async function syncClosedMarkets(): Promise<void> {
  // Check if we already have resolved markets — skip if so
  const existingResolved = await db.query(
    `SELECT COUNT(*) FROM markets WHERE platform = 'polymarket' AND status = 'resolved'`
  );
  const resolvedCount = parseInt(existingResolved.rows[0]?.count) || 0;

  if (resolvedCount > 1000) {
    log.info({ resolvedCount }, 'Closed markets already synced, skipping backfill');
    return;
  }

  log.info('Starting one-time closed market backfill...');
  const startTime = Date.now();
  let offset = 0;
  const limit = 100;
  let totalMarkets = 0;
  let newMarkets = 0;

  while (true) {
    const url = `${env.POLYMARKET_GAMMA_API}/events?closed=true&limit=${limit}&offset=${offset}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        log.warn({ status: response.status, offset }, 'Gamma API error during closed market sync');
        break;
      }
      const events = (await response.json()) as PolymarketGammaEvent[];
      if (events.length === 0) break;

      for (const event of events) {
        if (!event.markets) continue;
        for (const market of event.markets) {
          if (!market.conditionId) continue;

          // Determine resolved outcome from final prices
          let outcome: string | null = null;
          try {
            if (market.outcomePrices) {
              const prices = JSON.parse(market.outcomePrices) as string[];
              const yesPrice = parseFloat(prices[0] || '0.5');
              if (yesPrice > 0.99) outcome = 'YES';
              else if (yesPrice < 0.01) outcome = 'NO';
            }
          } catch {}

          const eventCat = event.category
            || event.tags?.map((t) => t.label).join(' ')
            || '';

          try {
            await upsertMarket(market, eventCat);
            // Set status to 'resolved' and outcome for closed markets
            if (outcome) {
              await db.query(
                `UPDATE markets SET status = 'resolved', outcome = $1
                 WHERE platform = 'polymarket' AND platform_id = $2 AND outcome IS NULL`,
                [outcome, market.conditionId]
              );
            }
            totalMarkets++;
          } catch {
            // skip individual errors
          }
        }
      }

      offset += limit;
      if (offset % 5000 === 0) {
        log.info({ offset, totalMarkets, newMarkets }, 'Closed market sync progress');
      }
      if (offset > 300000) break;

      // Small delay to avoid hammering API
      await new Promise(r => setTimeout(r, 50));
    } catch (err) {
      log.warn({ err, offset }, 'Error during closed market sync, continuing');
      offset += limit;
    }
  }

  const duration = Date.now() - startTime;
  log.info(
    { totalMarkets, durationMs: duration, durationMin: (duration / 60000).toFixed(1) },
    'Closed market backfill complete'
  );
}

/**
 * Main sync function — called by BullMQ every 5 minutes.
 *
 * Flow:
 * 1. Fetch all active events from Gamma API (paginated)
 * 2. Extract all markets from all events
 * 3. Upsert each market into PostgreSQL
 * 4. Log summary
 */
export async function syncPolymarketMarkets(): Promise<void> {
  log.info('Starting Polymarket market sync...');
  const startTime = Date.now();

  try {
    const events = await fetchEvents();

    let marketCount = 0;
    let newCount = 0;

    for (const event of events) {
      if (!event.markets) continue;

      for (const market of event.markets) {
        if (!market.conditionId) continue;

        // Check if this market already exists
        const existing = await db.query(
          'SELECT id FROM markets WHERE platform = $1 AND platform_id = $2',
          ['polymarket', market.conditionId]
        );

        if (existing.rows.length === 0) newCount++;

        // Extract category from event tags or market category
        const eventCat = event.category
          || event.tags?.map((t) => t.label).join(' ')
          || '';
        await upsertMarket(market, eventCat);
        marketCount++;
      }
    }

    const duration = Date.now() - startTime;
    log.info(
      { events: events.length, markets: marketCount, new: newCount, durationMs: duration },
      'Polymarket market sync complete'
    );
  } catch (err) {
    log.error({ err }, 'Polymarket market sync failed');
    throw err; // Let BullMQ handle retry
  }
}
