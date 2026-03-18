-- =============================================================
-- Migration 004: Fix trades deduplication + backfill market_id
-- =============================================================
--
-- PROBLEM:
--   1. No UNIQUE constraint on tx_hash → ON CONFLICT DO NOTHING
--      has zero effect → wallet enrichment inserts duplicate trades
--      every 24h when the Redis TTL expires.
--
--   2. Historical trades (from enrichment) were stored with
--      market_id = NULL because closed/resolved markets hadn't been
--      synced yet. Once stored as null, they never got updated.
--
-- FIX:
--   Step 1: Delete duplicate trades, keeping the best row per tx_hash
--           (prefer rows where market_id IS NOT NULL, then earliest created_at)
--
--   Step 2: Add a PARTIAL unique index on tx_hash (only where NOT NULL)
--           This makes ON CONFLICT (tx_hash) work correctly in app code.
--
--   Step 3: Backfill market_id for trades where it is NULL but we can
--           match the market via platform_id (conditionId from the Data API
--           = conditionId stored as platform_id in the markets table).
--           We can join on wallet_address's trades to markets... but since
--           we don't store conditionId in the trades table, we match via
--           wallet_id backfill and then hope market sync catches up.
--           The real backfill happens via app-level upsert after this migration.
-- =============================================================

-- Step 1: Remove duplicate trades, keeping best row per tx_hash
-- "Best" = has market_id set (not null), then earliest created_at
WITH ranked AS (
  SELECT
    id,
    tx_hash,
    market_id,
    ROW_NUMBER() OVER (
      PARTITION BY tx_hash
      ORDER BY
        (market_id IS NOT NULL) DESC,  -- prefer rows with market_id set
        created_at ASC                  -- then earliest created
    ) AS rn
  FROM trades
  WHERE tx_hash IS NOT NULL
)
DELETE FROM trades
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Step 2: Add partial unique index on tx_hash (only when not null)
-- Partial because some trades (chain indexer) may not have a tx_hash
CREATE UNIQUE INDEX IF NOT EXISTS trades_tx_hash_unique
  ON trades(tx_hash)
  WHERE tx_hash IS NOT NULL;
