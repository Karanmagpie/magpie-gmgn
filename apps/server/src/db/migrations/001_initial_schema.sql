-- =============================================================
-- MarkyPie Initial Database Schema
-- =============================================================
-- This migration runs automatically on first Docker Compose start.
-- It creates all tables needed for Phase 1 (data pipeline) and
-- future phases (alerts, copy trading, etc.)
--
-- To reset: docker compose down -v && docker compose up -d
-- =============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- CORE ENTITIES
-- =============================================================

-- Unified prediction markets from both Polymarket and Kalshi.
-- Each market is a single YES/NO question like "Will Fed cut rates?"
-- The same question on different platforms = 2 rows, linked by matched_market_id.
CREATE TABLE IF NOT EXISTS markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL,                        -- 'polymarket' | 'kalshi'
    platform_id TEXT NOT NULL,                     -- condition_id (Polymarket) or ticker (Kalshi)
    title TEXT NOT NULL,                           -- "Will the Fed cut rates in March 2026?"
    description TEXT,
    category TEXT,                                 -- politics, economics, sports, crypto, etc.
    status TEXT NOT NULL DEFAULT 'active',          -- active | closed | resolved
    yes_price NUMERIC,                             -- current YES price (0.00 to 1.00, e.g. 0.35 = 35%)
    no_price NUMERIC,                              -- current NO price (should be ~1 - yes_price)
    volume NUMERIC DEFAULT 0,                      -- total volume traded in USD
    liquidity NUMERIC DEFAULT 0,                   -- current liquidity in order book
    outcome TEXT,                                   -- 'yes' | 'no' | null (unresolved)
    resolution_source TEXT,                        -- UMA oracle (Polymarket) or official source (Kalshi)
    end_date TIMESTAMPTZ,                          -- when the market closes for trading
    safety_score INTEGER,                           -- 0-100 Market Safety Score (calculated in Phase 2)
    safety_details JSONB,                           -- { liquidity_score, resolution_score, manipulation_score, structural_score }
    token_ids TEXT[],                                -- ERC-1155 token IDs for WebSocket subscriptions (Polymarket only)
    matched_market_id UUID REFERENCES markets(id), -- links to equivalent market on other platform
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(platform, platform_id)                  -- one row per market per platform
);

-- Tracked Polymarket wallet profiles.
-- We discover these from the leaderboard API and on-chain activity.
-- Kalshi doesn't have wallets (anonymous) so this is Polymarket-only.
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address TEXT NOT NULL UNIQUE,                   -- Polygon wallet address (0x...)
    proxy_address TEXT,                              -- Polymarket proxy wallet if different
    pseudonym TEXT,                                  -- Polymarket display name (e.g. "@PolyWhale")
    profile_image TEXT,                              -- Profile picture URL
    x_username TEXT,                                 -- Twitter/X handle
    is_verified BOOLEAN DEFAULT false,
    tags TEXT[] DEFAULT '{}',                        -- ['whale', 'smart_money', 'elite_trader', 'kol']
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active TIMESTAMPTZ,                        -- updated every time we see a trade
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Smart Score per wallet per time period.
-- Recalculated periodically by the Smart Money Engine (Phase 2).
-- Score range: -100 (worst) to +100 (best)
CREATE TABLE IF NOT EXISTS wallet_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    period TEXT NOT NULL,                            -- '7d' | '30d' | '90d' | 'all'
    total_pnl NUMERIC NOT NULL DEFAULT 0,           -- profit/loss in USD
    total_volume NUMERIC NOT NULL DEFAULT 0,         -- total traded in USD
    win_rate NUMERIC,                               -- 0.0 to 1.0 (0.81 = 81%)
    total_markets INTEGER DEFAULT 0,                -- how many markets traded
    winning_markets INTEGER DEFAULT 0,              -- how many markets won
    avg_position_size NUMERIC,                      -- average position in USD
    roi NUMERIC,                                    -- return on investment as percentage
    sharpe_ratio NUMERIC,                           -- risk-adjusted return (higher = more consistent)
    smart_score INTEGER,                            -- -100 to 100 composite score
    category_expertise JSONB,                       -- { "politics": 0.89, "crypto": 0.76, ... }
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(wallet_id, period)                       -- one score per wallet per period
);

-- Individual trades on prediction markets.
-- On Polymarket: we know the wallet address (full transparency).
-- On Kalshi: trades are anonymous (wallet_id will be null).
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL,                         -- 'polymarket' | 'kalshi'
    market_id UUID REFERENCES markets(id),
    wallet_id UUID REFERENCES wallets(id),          -- null for Kalshi (anonymous)
    wallet_address TEXT,                            -- raw address for quick lookups
    side TEXT NOT NULL,                              -- 'BUY' | 'SELL'
    outcome TEXT NOT NULL,                           -- 'YES' | 'NO'
    price NUMERIC NOT NULL,                         -- price paid (0.00 to 1.00)
    size NUMERIC NOT NULL,                          -- trade size in USD
    token_amount NUMERIC,                           -- number of outcome shares
    tx_hash TEXT,                                   -- Polygon transaction hash (Polymarket only)
    is_whale BOOLEAN DEFAULT false,                 -- true if size > $10,000
    platform_timestamp TIMESTAMPTZ NOT NULL,        -- when the trade actually happened
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current positions: how many shares each wallet holds in each market.
-- Updated as new trades come in.
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    outcome TEXT NOT NULL,                           -- 'YES' | 'NO'
    size NUMERIC NOT NULL,                          -- number of shares held
    avg_price NUMERIC NOT NULL,                     -- average entry price
    initial_value NUMERIC NOT NULL,                 -- total cost basis in USD
    current_value NUMERIC,                          -- current market value
    unrealized_pnl NUMERIC,                         -- current_value - initial_value
    unrealized_pnl_pct NUMERIC,                     -- unrealized PnL as percentage
    realized_pnl NUMERIC DEFAULT 0,                 -- PnL from closed portions
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(wallet_id, market_id, outcome)           -- one position per wallet per market per side
);

-- =============================================================
-- FEATURE TABLES (used in Phase 2+)
-- =============================================================

-- User alert configurations.
-- Users set up rules like "alert me when a whale buys >$25K in politics markets"
CREATE TABLE IF NOT EXISTS alert_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,                          -- links to sessions table
    alert_type TEXT NOT NULL,                        -- whale_trade | new_market | price_move | arbitrage | wallet_activity
    config JSONB NOT NULL,                           -- { min_size: 25000, categories: ["politics"], wallets: ["0x..."] }
    delivery TEXT NOT NULL DEFAULT 'web',            -- web | telegram | both
    telegram_chat_id TEXT,                           -- for Telegram delivery
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Copy trade configurations.
-- "Copy @PolyWhale's trades: $50 fixed per trade, only politics, min safety 60"
CREATE TABLE IF NOT EXISTS copy_trade_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    target_wallet_id UUID NOT NULL REFERENCES wallets(id),
    sizing_mode TEXT NOT NULL DEFAULT 'fixed',       -- 'fixed' | 'proportional'
    fixed_amount NUMERIC,                            -- USD per trade (if fixed mode)
    proportional_pct NUMERIC,                        -- % of target's size (if proportional)
    max_per_trade NUMERIC,                           -- max USD per single trade
    max_per_market NUMERIC,                          -- max USD exposure per market
    min_market_safety INTEGER DEFAULT 50,            -- skip markets below this safety score
    category_filter TEXT[],                           -- only copy certain categories
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log of every copy trade execution.
-- Tracks what we copied, whether it succeeded, and the result.
CREATE TABLE IF NOT EXISTS copy_trade_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES copy_trade_configs(id) ON DELETE CASCADE,
    source_trade_id UUID REFERENCES trades(id),     -- the whale trade we're copying
    market_id UUID REFERENCES markets(id),
    side TEXT NOT NULL,
    outcome TEXT NOT NULL,
    price NUMERIC NOT NULL,
    size NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',           -- pending | executed | failed | skipped
    error_message TEXT,                               -- why it failed (if applicable)
    tx_hash TEXT,                                    -- Polygon tx hash of our copy trade
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Market Safety Score history.
-- Recalculated periodically. Stores the full breakdown.
CREATE TABLE IF NOT EXISTS market_safety_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    overall_score INTEGER NOT NULL,                   -- 0-100 total
    liquidity_score INTEGER NOT NULL,                 -- 0-25: bid-ask spread, depth, slippage
    resolution_score INTEGER NOT NULL,                -- 0-25: clarity, data source, oracle history
    manipulation_score INTEGER NOT NULL,              -- 0-25: whale concentration, suspicious wallets
    structural_score INTEGER NOT NULL,                -- 0-25: time to resolution, creator reputation
    details JSONB NOT NULL,                            -- full breakdown with explanations
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cross-platform arbitrage opportunities.
-- When the same question is priced differently on Polymarket vs Kalshi.
CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_a_id UUID NOT NULL REFERENCES markets(id),  -- typically Polymarket
    market_b_id UUID NOT NULL REFERENCES markets(id),  -- typically Kalshi
    price_a NUMERIC NOT NULL,                          -- YES price on platform A
    price_b NUMERIC NOT NULL,                          -- YES price on platform B
    spread NUMERIC NOT NULL,                           -- |price_a - price_b|
    spread_pct NUMERIC NOT NULL,                       -- spread as percentage
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expired_at TIMESTAMPTZ                             -- null = still active
);

-- Anonymous user sessions.
-- Users get a JWT on first visit, no signup needed.
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY,                              -- the JWT session ID
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- INDEXES
-- Performance-critical queries get dedicated indexes.
-- =============================================================

-- Find trades by market (market detail page: "show all trades for this market")
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);

-- Find trades by wallet (wallet profile: "show all trades for this wallet")
CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet_id);

-- Find only whale trades (whale feed: "show all trades > $10K")
CREATE INDEX IF NOT EXISTS idx_trades_whale ON trades(is_whale) WHERE is_whale = true;

-- Sort trades by time (most recent first)
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(platform_timestamp DESC);

-- Find positions by wallet (wallet profile: "show all positions")
CREATE INDEX IF NOT EXISTS idx_positions_wallet ON positions(wallet_id);

-- Find positions by market (market detail: "who holds positions in this market?")
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);

-- Look up market by platform + platform_id (sync: "does this market already exist?")
CREATE INDEX IF NOT EXISTS idx_markets_platform ON markets(platform, platform_id);

-- Filter markets by category (dashboard: "show all politics markets")
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);

-- Sort markets by safety score (dashboard: "show safest markets")
CREATE INDEX IF NOT EXISTS idx_markets_safety ON markets(safety_score);

-- Leaderboard: sort wallets by smart score
CREATE INDEX IF NOT EXISTS idx_wallet_scores_smart ON wallet_scores(smart_score DESC);

-- Find active arbitrage opportunities
CREATE INDEX IF NOT EXISTS idx_arb_active ON arbitrage_opportunities(expired_at) WHERE expired_at IS NULL;

-- Find trades by platform and time (for syncing: "get latest Polymarket trades")
CREATE INDEX IF NOT EXISTS idx_trades_platform_time ON trades(platform, platform_timestamp DESC);

-- Find wallets by address (for quick lookups during trade ingestion)
CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address);
