// =============================================================
// MarkyPie Server — Entry Point
// =============================================================
//
// This is the main entry point for the MarkyPie backend.
// It orchestrates ALL data pipeline components:
//
// 1. DATABASE CONNECTIONS
//    - PostgreSQL: primary data store (markets, trades, wallets)
//    - Redis: caching (prices), queues (BullMQ), feeds (whale trades)
//
// 2. DATABASE MIGRATIONS
//    - Runs SQL migration files on startup
//    - Creates all tables, indexes, constraints if they don't exist
//
// 3. SCHEDULED JOBS (via BullMQ)
//    - Market Sync: every 5 min — fetch markets from Polymarket + Kalshi
//    - Trade Ingestion: every 1 min — fetch trades, detect whales
//    - Wallet Discovery: every 24h — seed top wallets from leaderboard
//    - Market Matching: every 10 min — cross-platform fuzzy matching
//
// 4. REAL-TIME CONNECTIONS
//    - Polymarket WebSocket: instant price updates + whale detection
//    - Polygon Chain Indexer: on-chain trade events via ethers.js
//
// BULLMQ ARCHITECTURE:
//    BullMQ is a Redis-backed job queue for Node.js.
//    It replaces node-cron with production-grade features:
//
//    Queue → Jobs are added to a named queue (stored in Redis)
//    Worker → Picks jobs from queue and processes them
//    Repeatable → Jobs can repeat on a schedule (like cron)
//
//    Why BullMQ over node-cron?
//    - Jobs survive server restarts (persisted in Redis)
//    - Automatic retry with configurable backoff
//    - Horizontal scaling (multiple workers across machines)
//    - Built-in concurrency control
//    - Dead letter queue for failed jobs
//    - Job progress tracking and events
//
//    BullMQ requires `maxRetriesPerRequest: null` on the Redis
//    connection (configured in redis.ts). This is because BullMQ
//    uses blocking Redis commands (BRPOPLPUSH) that can take
//    longer than ioredis's default timeout.
//
// STARTUP ORDER:
//    1. Test PostgreSQL connection
//    2. Test Redis connection
//    3. Run database migrations
//    4. Start BullMQ workers (scheduled jobs)
//    5. Start WebSocket connection
//    6. Start chain indexer
//    7. Log "Server started" — ready to go
//
// GRACEFUL SHUTDOWN:
//    On SIGINT/SIGTERM (Ctrl+C or process kill):
//    1. Close BullMQ workers (finish current jobs)
//    2. Close WebSocket connection
//    3. Stop chain indexer
//    4. Close Redis connection
//    5. Close PostgreSQL pool
//    6. Exit process
//
// TO RUN:
//    npm run dev --workspace=apps/server
//    (uses tsx for TypeScript execution without compilation)
// =============================================================

import { Queue, Worker } from 'bullmq';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { testConnection, runMigration, closePool } from './db/postgres';
import { testRedisConnection, closeRedis } from './db/redis';
import { env } from './config/env';
import { createLogger } from './utils/logger';
import { app } from './api';

// Import Phase 1 ingestion modules
import { syncPolymarketMarkets, syncClosedMarkets } from './ingestion/polymarket-sync';
import { ingestPolymarketTrades } from './ingestion/polymarket-trades';
import { discoverPolymarketWallets } from './ingestion/polymarket-wallets';
import { connectPolymarketWebSocket, closePolymarketWebSocket, subscribeToMarkets } from './ingestion/polymarket-ws';
import { startChainIndexer, stopChainIndexer } from './ingestion/chain-indexer';
import { syncKalshiMarkets } from './ingestion/kalshi-sync';
import { matchMarkets } from './ingestion/market-matcher';

// Import Phase 2 intelligence modules
import { enrichWalletTrades } from './intelligence/wallet-enrichment';
import { updatePositions } from './intelligence/position-tracker';
import { calculateSmartScores } from './intelligence/smart-score';
import { calculateSafetyScores } from './intelligence/market-safety';
import { calculateConsensus } from './intelligence/consensus';

const log = createLogger('server');

// ---- BullMQ Configuration ----
//
// All queues share the same Redis connection.
// We pass the raw connection options (not the ioredis instance)
// because BullMQ creates its own dedicated connections internally.
// This is a BullMQ requirement — each Queue and Worker needs its
// own connection to avoid blocking issues with Redis pub/sub.
const _bullmqUrl = new URL(env.REDIS_URL);
const bullmqConnection = {
  host: _bullmqUrl.hostname || 'localhost',
  port: parseInt(_bullmqUrl.port || '6379', 10),
  username: _bullmqUrl.username || 'default',
  password: env.REDIS_PASSWORD || (_bullmqUrl.password ? decodeURIComponent(_bullmqUrl.password) : undefined),
  tls: _bullmqUrl.protocol === 'rediss:' ? {} : undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
};

// ---- Queues ----
// Each queue is a named channel for a specific type of job.
// Jobs in a queue are processed FIFO (first in, first out) by workers.

// Phase 1: Data Pipeline
const marketSyncQueue = new Queue('market-sync', { connection: bullmqConnection });
const tradeSyncQueue = new Queue('trade-sync', { connection: bullmqConnection });
const walletSyncQueue = new Queue('wallet-sync', { connection: bullmqConnection });
const marketMatchQueue = new Queue('market-match', { connection: bullmqConnection });

// Phase 2: Intelligence Layer
const walletEnrichmentQueue = new Queue('wallet-enrichment', { connection: bullmqConnection });
const positionSyncQueue = new Queue('position-sync', { connection: bullmqConnection });
const smartScoreQueue = new Queue('smart-score', { connection: bullmqConnection });
const safetyScoreQueue = new Queue('safety-score', { connection: bullmqConnection });
const consensusQueue = new Queue('consensus', { connection: bullmqConnection });

// ---- Workers ----
// Workers are stored so we can gracefully close them on shutdown.
const workers: Worker[] = [];

// ---- HTTP Server ----
// Stored so we can close it on graceful shutdown.
let httpServer: ServerType | null = null;

/**
 * Sets up BullMQ workers for all scheduled jobs.
 *
 * Each worker:
 * 1. Listens to its queue for new jobs
 * 2. Executes the job function when a job arrives
 * 3. Retries up to 3 times on failure (exponential backoff)
 * 4. Reports success/failure to BullMQ
 *
 * Repeatable jobs:
 * BullMQ's `repeat` option adds jobs to the queue on a schedule.
 * Unlike cron, these jobs are PERSISTED in Redis — if the server
 * crashes and restarts, the schedule continues from where it left off.
 */
async function setupWorkers(): Promise<void> {
  // ---- Market Sync Worker ----
  // Fetches markets from both Polymarket and Kalshi.
  // Schedule: every 5 minutes (300,000 ms)
  // Why 5 min? Markets don't change that fast — 5 min is responsive
  // enough for new market discovery while being API-friendly.
  const marketSyncWorker = new Worker(
    'market-sync',
    async () => {
      log.info('Running scheduled market sync...');

      // Sync both platforms in parallel for speed
      // Promise.allSettled ensures one failure doesn't block the other
      const results = await Promise.allSettled([
        syncPolymarketMarkets(),
        syncKalshiMarkets(),
      ]);

      // Log any failures
      for (const result of results) {
        if (result.status === 'rejected') {
          log.error({ err: result.reason }, 'Market sync job partial failure');
        }
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1, // Only 1 sync at a time (no parallel syncs)
    }
  );

  // ---- Trade Ingestion Worker ----
  // Fetches recent trades and detects whales.
  // Schedule: every 1 minute (60,000 ms)
  // Why 1 min? Trades need near-real-time detection for the whale feed.
  // 1 min is the minimum reasonable polling interval for the Data API.
  // (The WebSocket + chain indexer handle truly real-time detection.)
  const tradeSyncWorker = new Worker(
    'trade-sync',
    async () => {
      log.info('Running scheduled trade ingestion...');
      await ingestPolymarketTrades();
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
    }
  );

  // ---- Wallet Discovery Worker ----
  // Seeds top wallets from the Polymarket leaderboard.
  // Schedule: every 24 hours (86,400,000 ms)
  // Why daily? Leaderboard rankings change slowly. Daily updates
  // capture new whales without hammering the API. Each run fetches
  // 500 wallets and their profiles — takes ~2 minutes with rate limiting.
  const walletSyncWorker = new Worker(
    'wallet-sync',
    async () => {
      log.info('Running scheduled wallet discovery...');
      await discoverPolymarketWallets();
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
    }
  );

  // Market Matching — cross-platform fuzzy match + arbitrage detection
  // Schedule: every 10 min. Runs after market sync has fresh data.
  const marketMatchWorker = new Worker(
    'market-match',
    async () => {
      log.info('Running scheduled market matching...');
      await matchMarkets();
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  // ---- Phase 2: Intelligence Layer Workers ----

  // Wallet Enrichment — backfill detailed trade history per wallet
  // Schedule: every 30 min. 50 wallets per run at 200ms delay.
  const walletEnrichmentWorker = new Worker(
    'wallet-enrichment',
    async () => {
      log.info('Running scheduled wallet enrichment...');
      await enrichWalletTrades();
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  // Position Sync — aggregate trades into positions, update PnL
  // Schedule: every 5 min. Runs after trade ingestion for fresh data.
  const positionSyncWorker = new Worker(
    'position-sync',
    async () => {
      log.info('Running scheduled position sync...');
      await updatePositions();
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  // Smart Score — calculate wallet scores across all periods
  // Schedule: every 30 min. Expensive calc, doesn't need real-time.
  const smartScoreWorker = new Worker(
    'smart-score',
    async () => {
      log.info('Running scheduled Smart Score calculation...');
      await calculateSmartScores();
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  // Safety Score — rate markets on liquidity, resolution, manipulation, structure
  // Schedule: every 10 min. Medium frequency, uses existing data.
  const safetyScoreWorker = new Worker(
    'safety-score',
    async () => {
      log.info('Running scheduled Safety Score calculation...');
      await calculateSafetyScores();
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  // Consensus — what does smart money think about each market?
  // Schedule: every 2 min. Quick calculation, powers live dashboard.
  const consensusWorker = new Worker(
    'consensus',
    async () => {
      log.info('Running scheduled consensus calculation...');
      await calculateConsensus();
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  // Store workers for cleanup
  workers.push(
    marketSyncWorker, tradeSyncWorker, walletSyncWorker, marketMatchWorker,
    walletEnrichmentWorker, positionSyncWorker, smartScoreWorker,
    safetyScoreWorker, consensusWorker
  );

  // Set up error handlers for all workers
  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      log.error(
        { jobName: job?.name, queue: worker.name, err },
        'BullMQ job failed'
      );
    });

    worker.on('completed', (job) => {
      log.debug({ jobName: job?.name, queue: worker.name }, 'BullMQ job completed');
    });
  }

  // ---- Schedule Repeating Jobs ----
  // BullMQ's add() with repeat option creates a repeating schedule.
  // The job ID ensures only one schedule per type (no duplicates).
  // If a schedule already exists (from previous run), BullMQ skips it.

  await marketSyncQueue.add(
    'sync-markets',
    {},                           // No payload needed — worker fetches from API
    {
      repeat: {
        every: env.MARKET_SYNC_INTERVAL_MS, // 5 minutes
      },
      jobId: 'recurring-market-sync',       // Prevents duplicate schedules
      removeOnComplete: { count: 10 },      // Keep last 10 completed jobs
      removeOnFail: { count: 50 },          // Keep last 50 failed jobs for debugging
      attempts: 3,                          // Retry up to 3 times
      backoff: {
        type: 'exponential',                // 1s → 4s → 16s delay between retries
        delay: 1000,
      },
    }
  );

  await tradeSyncQueue.add(
    'sync-trades',
    {},
    {
      repeat: {
        every: env.TRADE_SYNC_INTERVAL_MS, // 1 minute
      },
      jobId: 'recurring-trade-sync',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    }
  );

  await walletSyncQueue.add(
    'sync-wallets',
    {},
    {
      repeat: {
        every: env.WALLET_SYNC_INTERVAL_MS, // 24 hours
      },
      jobId: 'recurring-wallet-sync',
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }, // 5s base for long jobs
    }
  );

  await marketMatchQueue.add(
    'match-markets',
    {},
    {
      repeat: { every: 10 * 60 * 1000 }, // 10 minutes
      jobId: 'recurring-market-match',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    }
  );

  // ---- Phase 2: Intelligence Layer Schedules ----

  await walletEnrichmentQueue.add(
    'enrich-wallets',
    {},
    {
      repeat: { every: env.WALLET_ENRICHMENT_INTERVAL_MS }, // 30 min
      jobId: 'recurring-wallet-enrichment',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    }
  );

  await positionSyncQueue.add(
    'sync-positions',
    {},
    {
      repeat: { every: env.POSITION_SYNC_INTERVAL_MS }, // 5 min
      jobId: 'recurring-position-sync',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    }
  );

  await smartScoreQueue.add(
    'calc-smart-scores',
    {},
    {
      repeat: { every: env.SMART_SCORE_INTERVAL_MS }, // 30 min
      jobId: 'recurring-smart-score',
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    }
  );

  await safetyScoreQueue.add(
    'calc-safety-scores',
    {},
    {
      repeat: { every: env.SAFETY_SCORE_INTERVAL_MS }, // 10 min
      jobId: 'recurring-safety-score',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    }
  );

  await consensusQueue.add(
    'calc-consensus',
    {},
    {
      repeat: { every: env.CONSENSUS_INTERVAL_MS }, // 2 min
      jobId: 'recurring-consensus',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    }
  );

  log.info('BullMQ workers and schedules initialized (Phase 1 + Phase 2)');
}

/**
 * Main startup function.
 *
 * This is the entry point that gets called when you run:
 *   npm run dev --workspace=apps/server
 *
 * It initializes everything in the correct order and starts
 * all data pipeline components.
 */
async function main(): Promise<void> {
  log.info('=== PMGN Server Starting ===');

  // ---- Step 1: Test Database Connections ----
  // Fail fast if PostgreSQL or Redis are not reachable.
  // There's no point starting workers if we can't store data.
  log.info('Testing database connections...');
  await testConnection();     // Throws if PostgreSQL is unreachable
  await testRedisConnection(); // Throws if Redis is unreachable
  log.info('Database connections verified');

  // ---- Step 2: Run Migrations ----
  // Creates all tables, indexes, and constraints if they don't exist.
  // Safe to run multiple times — uses IF NOT EXISTS and idempotent SQL.
  //
  // IMPORTANT: Migrations run BEFORE BullMQ workers start to avoid
  // deadlocks between ALTER TABLE and stale job queries.
  log.info('Running database migrations...');
  await runMigration();
  log.info('Database migrations complete');

  // ---- Step 2.5: Drain stale BullMQ jobs ----
  // When the server was killed abruptly (no graceful shutdown), BullMQ
  // leaves stale repeatable jobs in Redis. When new workers connect,
  // those stale jobs fire immediately — potentially conflicting with
  // migration locks or running before data is ready.
  // Draining old jobs + removing stale repeat configs prevents this.
  log.info('Cleaning stale BullMQ jobs...');
  const allQueues = [
    marketSyncQueue, tradeSyncQueue, walletSyncQueue, marketMatchQueue,
    walletEnrichmentQueue, positionSyncQueue, smartScoreQueue,
    safetyScoreQueue, consensusQueue,
  ];
  for (const q of allQueues) {
    try {
      // Remove old repeatable jobs (the schedule config, not the data)
      const repeatables = await q.getRepeatableJobs();
      for (const job of repeatables) {
        await q.removeRepeatableByKey(job.key);
      }
      // Drain any waiting/delayed jobs from previous runs
      await q.drain();
    } catch (err) {
      log.warn({ queue: q.name, err }, 'Failed to clean stale jobs (non-fatal)');
    }
  }
  log.info('Stale BullMQ jobs cleaned');

  // ---- Step 3: Start BullMQ Workers ----
  // Sets up job queues and starts processing scheduled jobs.
  // This is where the periodic syncs get scheduled.
  log.info('Setting up BullMQ workers...');
  await setupWorkers();

  // ---- Step 4: Start HTTP API Server ----
  // Start BEFORE initial sync so the API is available immediately.
  // It serves whatever data is already in the DB from previous runs.
  httpServer = serve(
    { fetch: app.fetch, port: env.PORT },
    () => log.info({ port: env.PORT }, 'HTTP API server listening')
  );

  // ---- Step 5: Start Real-Time Connections ----
  // These run continuously (not on a schedule).
  // WebSocket: real-time price updates from Polymarket CLOB
  // Chain Indexer: on-chain trade events from Polygon
  log.info('Starting real-time connections...');

  // Start WebSocket (non-blocking — runs in background)
  connectPolymarketWebSocket().catch((err) => {
    log.error({ err }, 'Failed to connect Polymarket WebSocket (will retry)');
  });

  // Chain indexer DISABLED for MVP — OrderFilled events lack market context
  // (no title, no outcome name). Data API polling every 60s is sufficient.
  // TODO: Re-enable when token ID → market mapping is built.
  // startChainIndexer().catch((err) => {
  //   log.error({ err }, 'Failed to start chain indexer (will retry)');
  // });

  // ---- Step 5: Backfill closed/resolved markets (one-time) ----
  // On first startup, sync all historical resolved markets from Gamma API.
  // This is needed because top traders made money on 2024 election markets
  // which are now closed — without them, trade enrichment can't link trades.
  // The function checks internally if it already ran (>1000 resolved markets).
  // ---- Step 6: Run Initial Sync ----
  // Kick off the first sync immediately (don't wait for BullMQ schedule).
  // This populates the database with markets, wallets, and trades
  // right away instead of waiting 5 minutes for the first scheduled run.
  log.info('Running initial data sync...');

  // Run initial syncs in parallel (fail gracefully — don't crash server)
  // Run Polymarket sync first (non-blocking), then wallet discovery after.
  // Kalshi sync intentionally excluded from startup — it pages through 178K markets
  // and caused OOM crashes when run simultaneously with Polymarket sync.
  // BullMQ will run the first Kalshi sync within 5 minutes on schedule.
  syncPolymarketMarkets()
    .then(() => subscribeToMarkets())
    .then(() => ingestPolymarketTrades())
    .catch((err) => {
      log.warn({ err }, 'Initial Polymarket sync failed (will retry on schedule)');
    });

  // Don't wait for wallet discovery — it takes ~2 minutes
  discoverPolymarketWallets().catch((err) => {
    log.warn({ err }, 'Initial wallet discovery failed (will retry on schedule)');
  });

  // Closed market backfill runs non-blocking — can take many minutes fetching
  // historical markets. Must NOT block wallet discovery or initial sync.
  log.info('Checking if closed market backfill is needed...');
  syncClosedMarkets().catch((err) => {
    log.warn({ err }, 'Closed market backfill failed (will work with existing data)');
  });

  // ---- Step 6: Phase 2 Intelligence Layer ----
  // Kick off initial enrichment (non-blocking).
  // Position sync, smart score, safety score, consensus will run on BullMQ schedule.
  // We also run safety scores on startup since they only need market data (already synced).
  log.info('Starting Phase 2 intelligence layer...');

  enrichWalletTrades()
    .then(() => {
      log.info('Initial wallet enrichment complete — running smart scores...');
      return calculateSmartScores();
    })
    .then(() => {
      log.info('Initial smart score calculation complete');
    })
    .catch((err) => {
      log.warn({ err }, 'Initial enrichment/smart-score failed (will retry on schedule)');
    });

  calculateSafetyScores().catch((err) => {
    log.warn({ err }, 'Initial safety score calculation failed (will retry on schedule)');
  });

  log.info('=== PMGN Server Started Successfully ===');
  log.info({
    schedules: {
      // Phase 1
      marketSync: `every ${env.MARKET_SYNC_INTERVAL_MS / 1000}s`,
      tradeSync: `every ${env.TRADE_SYNC_INTERVAL_MS / 1000}s`,
      walletSync: `every ${env.WALLET_SYNC_INTERVAL_MS / 1000}s`,
      // Phase 2
      walletEnrichment: `every ${env.WALLET_ENRICHMENT_INTERVAL_MS / 1000}s`,
      positionSync: `every ${env.POSITION_SYNC_INTERVAL_MS / 1000}s`,
      smartScore: `every ${env.SMART_SCORE_INTERVAL_MS / 1000}s`,
      safetyScore: `every ${env.SAFETY_SCORE_INTERVAL_MS / 1000}s`,
      consensus: `every ${env.CONSENSUS_INTERVAL_MS / 1000}s`,
    },
    realtime: {
      websocket: 'Polymarket CLOB WebSocket',
      chainIndexer: 'Polygon CTF Exchange events',
    },
  }, 'Server configuration');
}

// ---- Graceful Shutdown ----
//
// When the server receives SIGINT (Ctrl+C) or SIGTERM (kill command),
// we want to shut down cleanly:
// 1. Stop accepting new jobs
// 2. Wait for current jobs to finish
// 3. Close all connections
// 4. Exit with code 0 (success)
//
// Why graceful shutdown matters:
// - Without it, in-flight database transactions could be corrupted
// - Redis connections might not be properly cleaned up
// - BullMQ workers might leave jobs in a "stuck" state
// - Docker/Kubernetes needs clean exits for proper orchestration

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Received shutdown signal. Cleaning up...');

  try {
    // Close BullMQ workers (waits for current jobs to finish)
    for (const worker of workers) {
      await worker.close();
    }

    // Close BullMQ queues (Phase 1 + Phase 2)
    await marketSyncQueue.close();
    await tradeSyncQueue.close();
    await walletSyncQueue.close();
    await marketMatchQueue.close();
    await walletEnrichmentQueue.close();
    await positionSyncQueue.close();
    await smartScoreQueue.close();
    await safetyScoreQueue.close();
    await consensusQueue.close();
    // Close HTTP API server
    if (httpServer) {
      httpServer.close();
    }

    // Close real-time connections
    closePolymarketWebSocket();
    stopChainIndexer();

    // Close database connections
    await closeRedis();
    await closePool();

    log.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle unhandled rejections (async errors that aren't caught)
process.on('unhandledRejection', (err) => {
  log.error({ err }, 'Unhandled promise rejection');
});

// ---- Start the server ----
main().catch((err) => {
  log.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
