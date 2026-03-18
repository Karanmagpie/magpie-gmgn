// =============================================================
// Polymarket Wallet Discovery (Leaderboard + Profile APIs)
// =============================================================
//
// WHAT: Discovers and stores the top prediction market traders
//       from Polymarket's leaderboard.
//
// WHY:  These are our "smart money" wallets — the traders we
//       track, score, and let users copy-trade. Without discovering
//       these wallets, we have no whale tracking, no leaderboard,
//       no copy trading targets.
//
// APIs USED:
//
//   1. Polymarket Data API — Leaderboard
//      GET https://data-api.polymarket.com/v1/leaderboard
//      Returns: top traders ranked by PnL, volume, win rate
//      No auth required.
//
//   2. Polymarket Gamma API — Public Profiles
//      GET https://gamma-api.polymarket.com/public-profile?address={wallet}
//      Returns: display name, profile image, Twitter handle
//      No auth required.
//
// HOW:  Runs once daily via BullMQ.
//       1. Fetch top 500 wallets from leaderboard
//       2. For each wallet: upsert into wallets table
//       3. Fetch public profile for display name, image, social
//       4. Fetch positions for each wallet (for position tracking)
//
// DOCS: https://docs.polymarket.com/#leaderboard
// =============================================================

import { db } from '../db/postgres';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';
import { LEADERBOARD_SEED_COUNT } from '@markypie/shared';

const log = createLogger('polymarket-wallets');

/**
 * Fetches top traders from Polymarket leaderboard.
 *
 * API: GET https://data-api.polymarket.com/v1/leaderboard?limit=100&offset=0
 * Returns a flat JSON array with fields:
 *   rank (string), proxyWallet, userName, xUsername, verifiedBadge,
 *   vol (number), pnl (number), profileImage
 *
 * We fetch up to 500 wallets (LEADERBOARD_SEED_COUNT).
 */
async function fetchLeaderboard(): Promise<any[]> {
  const allTraders: any[] = [];
  let offset = 0;
  const limit = 50; // API max is 50

  while (allTraders.length < LEADERBOARD_SEED_COUNT) {
    // timePeriod=ALL for lifetime vol/pnl (default is DAY which gives daily snapshots)
    // orderBy=PNL to get highest profit traders
    const url = `${env.POLYMARKET_DATA_API}/v1/leaderboard?limit=${limit}&offset=${offset}&timePeriod=ALL&orderBy=PNL`;
    log.debug({ url, offset }, 'Fetching leaderboard page');

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Leaderboard API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const traders = Array.isArray(data) ? data : data.data || [];
    if (traders.length === 0) break;
    allTraders.push(...traders);

    offset += limit;
  }

  return allTraders.slice(0, LEADERBOARD_SEED_COUNT);
}

/**
 * Fetches a wallet's public profile from Gamma API.
 *
 * Returns display name, profile image, Twitter/X handle.
 * Returns null if the wallet has no public profile.
 *
 * Example response:
 * {
 *   name: "PolyWhale",
 *   profileImage: "https://...",
 *   twitterHandle: "polywhale_x"
 * }
 */
async function fetchProfile(address: string): Promise<{
  pseudonym: string | null;
  profileImage: string | null;
  xUsername: string | null;
} | null> {
  try {
    const url = `${env.POLYMARKET_GAMMA_API}/public-profile?address=${address}`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const data = (await response.json()) as any;

    return {
      pseudonym: data.name || data.username || null,
      profileImage: data.profileImage || data.profile_image || null,
      xUsername: data.twitterHandle || data.x_username || null,
    };
  } catch {
    return null;
  }
}

/**
 * Upserts a wallet into our database.
 *
 * If the wallet already exists (same address), update the profile info.
 * If it's new, insert it.
 */
async function upsertWallet(
  address: string,
  profile: { pseudonym: string | null; profileImage: string | null; xUsername: string | null } | null,
  leaderboardData?: { vol: number; pnl: number; rank: number }
): Promise<void> {
  await db.query(
    `INSERT INTO wallets (address, pseudonym, profile_image, x_username, total_volume, total_pnl, leaderboard_rank, last_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (address) DO UPDATE SET
       pseudonym = COALESCE(EXCLUDED.pseudonym, wallets.pseudonym),
       profile_image = COALESCE(EXCLUDED.profile_image, wallets.profile_image),
       x_username = COALESCE(EXCLUDED.x_username, wallets.x_username),
       total_volume = COALESCE(EXCLUDED.total_volume, wallets.total_volume),
       total_pnl = COALESCE(EXCLUDED.total_pnl, wallets.total_pnl),
       leaderboard_rank = COALESCE(EXCLUDED.leaderboard_rank, wallets.leaderboard_rank),
       last_active = NOW()`,
    [
      address.toLowerCase(),
      profile?.pseudonym || null,
      profile?.profileImage || null,
      profile?.xUsername || null,
      leaderboardData?.vol ?? 0,
      leaderboardData?.pnl ?? 0,
      leaderboardData?.rank ?? null,
    ]
  );
}

/**
 * Main wallet discovery function — called by BullMQ once daily.
 *
 * Flow:
 * 1. Fetch top 500 wallets from leaderboard
 * 2. For each wallet: fetch profile, upsert into database
 * 3. Small delay between profile fetches to avoid rate limiting
 */
export async function discoverPolymarketWallets(): Promise<void> {
  log.info('Starting Polymarket wallet discovery...');
  const startTime = Date.now();

  try {
    const traders = await fetchLeaderboard();
    log.info({ count: traders.length }, 'Fetched leaderboard');

    let upsertedCount = 0;
    let profilesFetched = 0;

    for (const trader of traders) {
      // API field: proxyWallet (not address or wallet)
      const address = (trader.proxyWallet || '').toLowerCase();
      if (!address) continue;

      // The leaderboard already includes profile data:
      //   userName, profileImage, xUsername, verifiedBadge
      // So we use those directly instead of making a separate profile API call.
      // We still call the Gamma profile API for the pseudonym field.
      const profile = await fetchProfile(address);

      // Merge leaderboard data with profile data
      const mergedProfile = {
        pseudonym: profile?.pseudonym || trader.userName || null,
        profileImage: trader.profileImage || profile?.profileImage || null,
        xUsername: trader.xUsername || profile?.xUsername || null,
      };
      if (mergedProfile.pseudonym) profilesFetched++;

      // Upsert wallet into database with leaderboard stats
      await upsertWallet(address, mergedProfile, {
        vol: typeof trader.vol === 'number' ? trader.vol : 0,
        pnl: typeof trader.pnl === 'number' ? trader.pnl : 0,
        rank: parseInt(trader.rank, 10) || 0,
      });
      upsertedCount++;

      // Small delay to avoid rate limiting (100ms between requests)
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Backfill wallet_id on existing trades that were inserted before wallets were discovered.
    // Trades store wallet_address (raw string) but wallet_id (FK) was null when wallets table
    // was empty. This single UPDATE links all historical trades to their wallet rows.
    const backfill = await db.query(`
      UPDATE trades t
      SET wallet_id = w.id
      FROM wallets w
      WHERE t.wallet_address = w.address
        AND t.wallet_id IS NULL
    `);
    log.info({ backfilled: backfill.rowCount }, 'Backfilled wallet_id on existing trades');

    const duration = Date.now() - startTime;
    log.info(
      { wallets: upsertedCount, profiles: profilesFetched, durationMs: duration },
      'Polymarket wallet discovery complete'
    );
  } catch (err) {
    log.error({ err }, 'Polymarket wallet discovery failed');
    throw err;
  }
}
