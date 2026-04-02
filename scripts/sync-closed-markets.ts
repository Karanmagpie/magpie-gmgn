// =============================================================
// One-Time Closed Market Backfill Script
// =============================================================
//
// Syncs ALL closed/resolved Polymarket markets into the production DB.
// This is needed so wallet trade history can link to market names.
//
// Why: Wallet enrichment fetches historical trades. Those trades
// reference markets that are now closed. Without these markets
// in the DB, trades show "Unknown market" in the UI.
//
// Run with:
//   npx ts-node scripts/sync-closed-markets.ts
//
// Or compile first:
//   npx tsc scripts/sync-closed-markets.ts --outDir scripts/dist --esModuleInterop --resolveJsonModule
//   node scripts/dist/sync-closed-markets.js
//
// Takes ~15-30 minutes (Polymarket has ~46K+ closed markets).
// Progress is logged every 1000 markets.
// Safe to re-run — uses UPSERT (INSERT ... ON CONFLICT DO UPDATE).
// =============================================================

import { Pool } from 'pg';

// ── Production DB — Neon DB ──────────────────────────────────
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_HdX09LTlvPop@ep-quiet-mouse-adps95i8-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const GAMMA_API = 'https://gamma-api.polymarket.com';

// ── DB Pool ──────────────────────────────────────────────────
const db = new Pool({ connectionString: DATABASE_URL, max: 3 });

// ── Category Normalizer ──────────────────────────────────────
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

// ── Upsert Market ────────────────────────────────────────────
async function upsertMarket(market: any, eventCategory: string): Promise<void> {
  let yesPrice: number | null = null;
  let noPrice: number | null = null;

  try {
    if (market.outcomePrices) {
      const prices = JSON.parse(market.outcomePrices) as string[];
      const outcomes = market.outcomes ? (JSON.parse(market.outcomes) as string[]) : ['Yes', 'No'];
      const yesIdx = outcomes.findIndex((o: string) => o === 'Yes');
      const noIdx = outcomes.findIndex((o: string) => o === 'No');
      if (yesIdx !== -1 && prices[yesIdx]) yesPrice = parseFloat(prices[yesIdx]);
      if (noIdx !== -1 && prices[noIdx]) noPrice = parseFloat(prices[noIdx]);
    }
  } catch {
    if (market.lastTradePrice != null) {
      yesPrice = market.lastTradePrice;
      noPrice = 1 - market.lastTradePrice;
    }
  }

  let tokenIds: string[] | null = null;
  try {
    if (market.clobTokenIds) tokenIds = JSON.parse(market.clobTokenIds) as string[];
  } catch {}

  await db.query(
    `INSERT INTO markets (
      platform, platform_id, title, description, category, status,
      yes_price, no_price, volume, liquidity, end_date, token_ids, updated_at
    ) VALUES (
      'polymarket', $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11, NOW()
    )
    ON CONFLICT (platform, platform_id) DO UPDATE SET
      title       = EXCLUDED.title,
      description = EXCLUDED.description,
      category    = EXCLUDED.category,
      status      = EXCLUDED.status,
      yes_price   = EXCLUDED.yes_price,
      no_price    = EXCLUDED.no_price,
      volume      = EXCLUDED.volume,
      liquidity   = EXCLUDED.liquidity,
      end_date    = EXCLUDED.end_date,
      token_ids   = COALESCE(EXCLUDED.token_ids, markets.token_ids),
      updated_at  = NOW()`,
    [
      market.conditionId,
      market.question,
      market.description || null,
      normalizeCategory(eventCategory || market.category),
      'resolved',                                           // all closed markets = resolved
      yesPrice,
      noPrice,
      market.volumeNum || parseFloat(market.volume) || 0,
      market.liquidityNum || 0,
      market.endDate || market.endDateIso || null,
      tokenIds,
    ]
  );
}

// ── Main ─────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('Connecting to production DB...');
  const pingResult = await db.query('SELECT NOW() as time, COUNT(*) as markets FROM markets WHERE platform = $1', ['polymarket']);
  console.log(`Connected. Current Polymarket markets in DB: ${pingResult.rows[0].markets}`);

  const resolvedCheck = await db.query(
    `SELECT COUNT(*) as count FROM markets WHERE platform = 'polymarket' AND status = 'resolved'`
  );
  console.log(`Current resolved markets: ${resolvedCheck.rows[0].count}`);

  console.log('\nStarting closed market sync from Gamma API...');

  const startTime = Date.now();
  let offset = 0;
  const limit = 200;
  let totalMarkets = 0;
  let errors = 0;

  while (true) {
    const url = `${GAMMA_API}/events?closed=true&limit=${limit}&offset=${offset}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Gamma API returned ${response.status} at offset ${offset}, stopping`);
        break;
      }

      const events = (await response.json()) as any[];
      if (events.length === 0) {
        console.log(`No more events at offset ${offset}. Done!`);
        break;
      }

      for (const event of events) {
        if (!event.markets) continue;

        const eventCat = event.category
          || event.tags?.map((t: any) => t.label).join(' ')
          || '';

        for (const market of event.markets) {
          if (!market.conditionId || !market.question) continue;

          try {
            await upsertMarket(market, eventCat);

            // Set resolved outcome based on final price
            let outcome: string | null = null;
            try {
              if (market.outcomePrices) {
                const prices = JSON.parse(market.outcomePrices) as string[];
                const yesPrice = parseFloat(prices[0] || '0.5');
                if (yesPrice > 0.99) outcome = 'YES';
                else if (yesPrice < 0.01) outcome = 'NO';
              }
            } catch {}

            if (outcome) {
              await db.query(
                `UPDATE markets SET status = 'resolved', outcome = $1
                 WHERE platform = 'polymarket' AND platform_id = $2 AND outcome IS NULL`,
                [outcome, market.conditionId]
              );
            }

            totalMarkets++;
          } catch (err: any) {
            errors++;
            if (errors < 5) console.error(`Error upserting market ${market.conditionId}:`, err.message);
          }
        }
      }

      offset += limit;

      // Progress every 1000 markets
      if (totalMarkets > 0 && totalMarkets % 1000 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log(`Progress: ${totalMarkets} markets synced (offset ${offset}) — ${elapsed} min elapsed`);
      }

      // Safety limit (Polymarket has ~46K closed events)
      if (offset > 500000) {
        console.log('Reached offset limit 500000, stopping');
        break;
      }

      // 300ms delay between pages — enough to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));

    } catch (err: any) {
      console.warn(`Error at offset ${offset}:`, err.message, '— continuing');
      errors++;
      offset += limit;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nDone! ${totalMarkets} markets synced in ${elapsed} minutes. Errors: ${errors}`);

  // Final count
  const finalCount = await db.query(
    `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'resolved') as resolved FROM markets WHERE platform = 'polymarket'`
  );
  console.log(`Final DB state: ${finalCount.rows[0].total} total Polymarket markets, ${finalCount.rows[0].resolved} resolved`);

  await db.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
