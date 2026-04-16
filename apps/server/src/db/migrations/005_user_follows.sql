-- =============================================================
-- Migration 005: User Follows
-- =============================================================
-- Personalized Following Feed — lets users (identified by their
-- connected wallet address) follow specific Polymarket wallets
-- and get a filtered feed of only those wallets' trades.
--
-- No separate "users" table needed — the connected wallet
-- address IS the user identity.
-- =============================================================

CREATE TABLE IF NOT EXISTS user_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address TEXT NOT NULL,          -- the connected wallet (the user)
  wallet_address TEXT NOT NULL,        -- the wallet being followed
  pseudonym TEXT,                      -- cached display name (DrPufferfish etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_address, wallet_address)
);

-- Fast lookup: "which wallets does this user follow?"
CREATE INDEX IF NOT EXISTS idx_user_follows_user ON user_follows(user_address);

-- Fast lookup: "how many followers does this wallet have?"
CREATE INDEX IF NOT EXISTS idx_user_follows_wallet ON user_follows(wallet_address);
