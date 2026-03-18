-- =============================================================
-- Phase 2.1: Smart Score Component Breakdown
-- =============================================================
-- Stores individual component scores so the frontend can show
-- WHY a wallet got its Smart Score (win rate contribution,
-- ROI contribution, etc). Users can make their own judgment.
--
-- Safe to run multiple times — uses ADD COLUMN IF NOT EXISTS.
-- =============================================================

-- Component scores (0-100 each, before weighting)
ALTER TABLE wallet_scores ADD COLUMN IF NOT EXISTS win_rate_score INTEGER;
ALTER TABLE wallet_scores ADD COLUMN IF NOT EXISTS roi_score INTEGER;
ALTER TABLE wallet_scores ADD COLUMN IF NOT EXISTS consistency_score INTEGER;
ALTER TABLE wallet_scores ADD COLUMN IF NOT EXISTS volume_score INTEGER;

-- Data quality indicator
ALTER TABLE wallet_scores ADD COLUMN IF NOT EXISTS data_quality TEXT DEFAULT 'low';
