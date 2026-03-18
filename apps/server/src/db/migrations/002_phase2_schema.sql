-- =============================================================
-- Phase 2: Intelligence Layer Schema Additions
-- =============================================================
-- Adds columns and indexes needed for Smart Score, Market Safety
-- Score, position tracking, and wallet enrichment.
--
-- Safe to run multiple times — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- =============================================================

-- Add leaderboard stats to wallets table.
-- These come from the Polymarket leaderboard API (vol, pnl, rank)
-- and are used as bootstrap data for Smart Score calculation.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_volume NUMERIC DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_pnl NUMERIC DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS leaderboard_rank INTEGER;

-- Index for looking up wallet scores by wallet + period
-- Used by: Smart Score calculator, consensus calculation, leaderboard queries
CREATE INDEX IF NOT EXISTS idx_wallet_scores_wallet_period
  ON wallet_scores(wallet_id, period);

-- Index for position lookups by wallet + market + outcome
-- Used by: Position tracker, Smart Score (checking resolved positions)
CREATE INDEX IF NOT EXISTS idx_positions_wallet_outcome
  ON positions(wallet_id, market_id, outcome);

-- Index for enrichment: find latest trades per wallet
-- Used by: Wallet enrichment module to detect what we already have
CREATE INDEX IF NOT EXISTS idx_trades_wallet_time
  ON trades(wallet_address, platform_timestamp DESC);

-- Index for deduplication during enrichment
CREATE INDEX IF NOT EXISTS idx_trades_tx_hash
  ON trades(tx_hash) WHERE tx_hash IS NOT NULL;
