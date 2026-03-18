# MarkyPie - GMGN for Prediction Markets

## The Vision

**GMGN.ai tracks smart money and provides trading tools for memecoins. MarkyPie does the same for prediction markets (Polymarket + Kalshi).**

Just like GMGN helps retail traders see what whales are doing on PumpFun/Raydium, MarkyPie helps retail traders see what smart money is doing on Polymarket and Kalshi — which markets they're entering, what positions they're taking, and how to follow them.

---

## The GMGN → MarkyPie Feature Map 

```
GMGN (Memecoins)                    MarkyPie (Prediction Markets)
────────────────                    ─────────────────────────────

Smart Money Tracking          →     Whale wallet tracking on Polymarket
  (whale wallets on Solana)           + large trade detection on Kalshi

Pump Scanner                  →     New Market Scanner
  (new tokens on PumpFun)            (new markets on Polymarket/Kalshi)

Token Security Analysis       →     Market Safety Score
  (rug pull, honeypot checks)        (liquidity traps, oracle risk, manipulation)

Copy Trading                  →     Copy Trading on Polymarket
  (mirror whale trades)              (mirror whale positions automatically)

Sniper Bot                    →     Early Entry Bot
  (buy at token launch)              (enter markets before odds shift)

Real-time Alerts              →     Smart Money Alerts
  (whale buys a token)               (whale enters a market, odds spike, arbitrage)

Holder Analysis               →     Position Analysis
  (who holds what tokens)            (who holds YES/NO, whale concentration)

Leaderboard                   →     Cross-Platform Leaderboard
  (top profitable traders)           (top traders across Polymarket + Kalshi)

Anti-MEV                      →     Execution Quality
  (sandwich attack protection)       (slippage protection, best price routing)

Cross-chain                   →     Cross-Platform
  (Solana + ETH + BSC)              (Polymarket + Kalshi + future platforms)
```

---

## Problem Statement

Prediction markets are booming ($21.5B on Polymarket, $22.8B on Kalshi in 2025) but retail traders face massive disadvantages:

1. **Information Asymmetry** — Whales and insiders take positions before news breaks. Retail traders have no way to see what smart money is doing across platforms
2. **Fragmented Ecosystem** — Polymarket (on-chain, USDC) and Kalshi (off-chain, USD) are completely separate. No unified view exists
3. **No Market Quality Signals** — Unlike memecoins where GMGN flags rug pulls, prediction markets have their own risks (low liquidity traps, oracle manipulation, ambiguous resolution criteria) with no standardized scoring
4. **Manual Research Overload** — 170+ fragmented tools exist but no all-in-one platform combining smart money tracking + copy trading + alerts + analytics

## Solution

MarkyPie — a unified prediction market intelligence platform that:
- Tracks smart money wallets across Polymarket in real-time
- Detects large trades and insider patterns on both platforms
- Provides a Market Safety Score for every market
- Enables one-click copy trading of top performers
- Scans for new market opportunities and arbitrage
- Delivers real-time alerts via web + Telegram

---

## Competitive Landscape

| Tool | What It Does | What It Lacks |
|---|---|---|
| **PolyTrack** | Polymarket whale tracking + alerts | Polymarket only, no copy trading, no Kalshi |
| **Hashdive** | Smart Scores for Polymarket + Kalshi | Analytics only, no trading, no alerts |
| **Polysights** | AI-powered Polymarket analytics | No Kalshi, no copy trading, no market safety score |
| **Unusual Predictions** | Insider tracking (Unusual Whales) | $48/mo, analytics only, no trading execution |
| **Oddpool** | Cross-venue odds aggregation | Data only, no smart money, no trading |
| **0xInsider** | Cross-platform trading terminal | 7K traders tracked but no market safety scoring |

**The gap:** No single platform combines smart money tracking + copy trading + market safety scoring + cross-platform aggregation + alerts in one product. MarkyPie fills this gap.

---

## Data Sources & APIs

### Polymarket (Primary — Full On-Chain Transparency)

Polymarket has **3 APIs + 2 WebSocket services**:

| Service | Base URL | Auth | Purpose |
|---|---|---|---|
| **Gamma API** | `https://gamma-api.polymarket.com` | None | Market discovery, metadata, events |
| **CLOB API** | `https://clob.polymarket.com` | API key for writes | Order book, prices, trading |
| **Data API** | `https://data-api.polymarket.com` | None | Trades, positions, leaderboard, activity |
| **CLOB WS** | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | None | Real-time order book + price updates |
| **Live Data WS** | `wss://ws-live-data.polymarket.com` | None | Real-time trade feed |

**Key endpoints we use:**

```
MARKET DISCOVERY:
  GET gamma-api/events                          → All active events with markets
  GET gamma-api/markets                         → Market metadata, liquidity, volume

SMART MONEY TRACKING:
  GET data-api/v1/leaderboard                   → Top traders by PnL, category, time period
  GET data-api/trades?user={wallet}             → All trades by a specific wallet
  GET data-api/positions?user={wallet}          → Current positions of a wallet
  GET data-api/activity?user={wallet}           → Full activity history
  GET data-api/trades?filterType=CASH&filterAmount=10000  → Filter whale trades ($10K+)

MARKET DATA:
  GET clob-api/book?token_id={id}               → Full order book
  GET clob-api/prices-history?market={id}       → Historical price timeseries
  GET clob-api/midpoint?token_id={id}           → Current midpoint price

PROFILES:
  GET gamma-api/public-profile?address={wallet} → Trader profile, pseudonym, X handle

REAL-TIME:
  WSS clob-ws → subscribe to: book, price_change, last_trade_price
  WSS live-data-ws → subscribe to: activity (trades)
```

**On-Chain Contracts (Polygon):**

| Contract | Address | What We Monitor |
|---|---|---|
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` | `OrderFilled`, `OrdersMatched` events |
| NegRisk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` | Multi-outcome market trades |
| Conditional Tokens | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` | `PositionsSplit`, `PositionsMerge` |
| Proxy Wallet Factory | `0xaB45c5A4B0c941a2F231C04C3f49182e1A254052` | New user wallet creation |

### Kalshi (Secondary — Centralized, Limited Transparency)

| Service | Base URL | Auth |
|---|---|---|
| **REST API** | `https://api.elections.kalshi.com/trade-api/v2` | RSA key signing |
| **WebSocket** | `wss://api.elections.kalshi.com/trade-api/ws/v2` | RSA key signing |
| **Demo API** | `https://demo-api.kalshi.co/trade-api/v2` | RSA key signing |

**Key endpoints:**

```
MARKET DATA:
  GET /markets                                  → All markets (filterable, no auth needed)
  GET /events                                   → All events
  GET /markets/{ticker}/orderbook               → Order book (auth required)
  GET /markets/trades                           → Public trade history (no wallet identity)
  GET /series/{ticker}/markets/{ticker}/candlesticks → OHLCV price history

REAL-TIME:
  WSS → channels: ticker, trade, orderbook_delta, market_lifecycle_v2
```

**Kalshi limitation:** No wallet/user transparency. Trade history is anonymous. Smart money tracking on Kalshi relies on volume anomaly detection, not wallet tracking.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js 22 LTS + TypeScript 5.x | Event-loop for real-time data streaming, shared types |
| **Frontend** | Next.js 15 + React 19 | SSR for SEO, API routes, fast dev |
| **Styling** | Tailwind CSS 4 | Dark-theme trading UI |
| **Charts** | TradingView Lightweight Charts v5 | 45KB, free, plugin system for custom overlays |
| **WebSocket Server** | ws ^8.18 | Broadcast real-time whale activity to clients |
| **WebSocket Client** | react-use-websocket ^4.9 | Auto-reconnect, shared connections |
| **Primary DB** | PostgreSQL 16+ | Wallet profiles, positions, trade history, JSONB flexibility |
| **Cache / Real-time** | Redis 7+ (ioredis ^5.4) | Hot state, Pub/Sub, leaderboard sorted sets, rate limiting |
| **Job Queue** | BullMQ ^5.x | Background jobs: data sync, alert dispatch, copy trade execution |
| **Auth** | JWT (jsonwebtoken ^9.0) | Anonymous sessions for MVP, optional login later |
| **Blockchain Indexer** | Polygon RPC + ethers.js | Monitor Polymarket contract events on-chain |
| **Alerts** | Telegram Bot API (grammy) | Whale alerts, price movement alerts |
| **Polymarket Client** | @polymarket/clob-client | Official SDK for order execution (copy trading) |
| **Kalshi Client** | Custom REST client | RSA-signed API calls |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                  │
│                                                                         │
│  Next.js 15 App (React 19 + Tailwind)                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ Dashboard    │ │ Smart Money  │ │ Market       │ │ Copy Trading │  │
│  │ (trending    │ │ Tracker      │ │ Detail Page  │ │ Panel        │  │
│  │  markets,    │ │ (whale       │ │ (odds chart, │ │ (follow top  │  │
│  │  new markets,│ │  feed, whale │ │  safety score│ │  wallets,    │  │
│  │  hot events) │ │  profiles)   │ │  positions)  │ │  auto-trade) │  │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘  │
│         └────────────────┴────────────────┴────────────────┘           │
│                                    │                                    │
│                          react-use-websocket                            │
│                       (real-time whale feed)                            │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ WebSocket
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                          SERVER LAYER                                   │
│                                                                         │
│  Node.js 22 + TypeScript                                                │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    DATA INGESTION ENGINE                          │   │
│  │                                                                  │   │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │   │
│  │  │ Polymarket      │  │ Kalshi           │  │ On-Chain       │  │   │
│  │  │ Sync Worker     │  │ Sync Worker      │  │ Indexer        │  │   │
│  │  │                 │  │                  │  │                │  │   │
│  │  │ • Gamma API     │  │ • REST API       │  │ • Polygon RPC  │  │   │
│  │  │   (markets)     │  │   (markets)      │  │ • OrderFilled  │  │   │
│  │  │ • Data API      │  │ • Trade feed     │  │   events       │  │   │
│  │  │   (trades,      │  │ • WebSocket      │  │ • PositionSplit│  │   │
│  │  │    positions,   │  │   (ticker,       │  │   events       │  │   │
│  │  │    leaderboard) │  │    trade)        │  │ • Whale tx     │  │   │
│  │  │ • CLOB WS       │  │                  │  │   detection    │  │   │
│  │  │   (live trades) │  │                  │  │                │  │   │
│  │  └────────┬────────┘  └────────┬─────────┘  └───────┬────────┘  │   │
│  │           └────────────────────┼─────────────────────┘           │   │
│  │                                ▼                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐    │   │
│  │  │              UNIFIED DATA NORMALIZER                      │    │   │
│  │  │                                                          │    │   │
│  │  │  • Normalize markets from both platforms                  │    │   │
│  │  │  • Match equivalent markets across platforms              │    │   │
│  │  │  • Normalize prices, volumes, timestamps                  │    │   │
│  │  │  • Calculate cross-platform arbitrage                     │    │   │
│  │  └──────────────────────┬───────────────────────────────────┘    │   │
│  └─────────────────────────┼────────────────────────────────────────┘   │
│                            │                                            │
│  ┌─────────────────────────▼────────────────────────────────────────┐   │
│  │                    INTELLIGENCE LAYER                             │   │
│  │                                                                  │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐ │   │
│  │  │ Smart Money    │  │ Market Safety  │  │ Alert Engine       │ │   │
│  │  │ Engine         │  │ Scorer         │  │                    │ │   │
│  │  │                │  │                │  │ • Whale trade alert│ │   │
│  │  │ • Wallet       │  │ • Liquidity    │  │ • New market alert │ │   │
│  │  │   scoring      │  │   health (25)  │  │ • Price spike alert│ │   │
│  │  │ • Win rate     │  │ • Resolution   │  │ • Arbitrage alert  │ │   │
│  │  │   tracking     │  │   integrity(25)│  │ • Insider alert    │ │   │
│  │  │ • Whale        │  │ • Manipulation │  │                    │ │   │
│  │  │   detection    │  │   risk (25)    │  │ Delivery:          │ │   │
│  │  │ • Category     │  │ • Structural   │  │ • WebSocket (web)  │ │   │
│  │  │   expertise    │  │   risk (25)    │  │ • Telegram bot     │ │   │
│  │  └────────────────┘  └────────────────┘  └────────────────────┘ │   │
│  │                                                                  │   │
│  │  ┌────────────────┐  ┌────────────────────────────────────────┐ │   │
│  │  │ Copy Trade     │  │ Market Matcher                         │ │   │
│  │  │ Engine         │  │                                        │ │   │
│  │  │                │  │ • Identifies same question on           │ │   │
│  │  │ • Follow whale │  │   Polymarket vs Kalshi                 │ │   │
│  │  │ • Mirror       │  │ • Detects price discrepancies           │ │   │
│  │  │   positions    │  │ • Flags arbitrage opportunities         │ │   │
│  │  │ • Auto-execute │  │                                        │ │   │
│  │  │   on Polymarket│  │ Example: "Fed cuts rates March 2026?"  │ │   │
│  │  │   via CLOB API │  │   Polymarket YES: $0.22                │ │   │
│  │  └────────────────┘  │   Kalshi YES:     $0.25                │ │   │
│  │                      │   → 3 cent arb opportunity!             │ │   │
│  │                      └────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    API LAYER                                     │   │
│  │                                                                  │   │
│  │  REST:                            WebSocket:                     │   │
│  │  GET  /api/markets                whale_trade (live feed)        │   │
│  │  GET  /api/markets/:id            new_market                     │   │
│  │  GET  /api/wallets/:address       price_change                   │   │
│  │  GET  /api/wallets/:address/pos   arbitrage_opportunity          │   │
│  │  GET  /api/leaderboard            alert                          │   │
│  │  GET  /api/alerts                                                │   │
│  │  POST /api/copy-trade/follow                                     │   │
│  │  POST /api/copy-trade/unfollow                                   │   │
│  │  GET  /api/arbitrage                                             │   │
│  │  GET  /api/market-safety/:id                                     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌─────────────────────────┐
│   PostgreSQL 16  │ │   Redis 7    │ │  External APIs          │
│                  │ │              │ │                         │
│ • wallets        │ │ • live whale │ │  Polymarket Gamma API   │
│ • wallet_scores  │ │   feed       │ │  Polymarket Data API    │
│ • markets        │ │ • market     │ │  Polymarket CLOB API    │
│ • positions      │ │   prices     │ │  Polymarket CLOB WS     │
│ • trades         │ │ • alert      │ │  Polygon RPC (on-chain) │
│ • alerts_config  │ │   queue      │ │  Kalshi REST API        │
│ • copy_trades    │ │ • leaderboard│ │  Kalshi WebSocket       │
│ • market_safety  │ │ • rate limit │ │                         │
└──────────────────┘ └──────────────┘ └─────────────────────────┘
```

---

## Database Schema

```sql
-- ═══ CORE ENTITIES ═══

-- Tracked prediction markets (unified across platforms)
CREATE TABLE markets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL,                       -- 'polymarket' | 'kalshi'
    platform_id TEXT NOT NULL,                    -- condition_id (PM) or ticker (Kalshi)
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,                                -- politics, sports, crypto, economics, etc.
    status TEXT NOT NULL DEFAULT 'active',         -- active | closed | resolved
    yes_price NUMERIC,                            -- current YES price (0.00-1.00)
    no_price NUMERIC,                             -- current NO price
    volume NUMERIC DEFAULT 0,                     -- total volume traded
    liquidity NUMERIC DEFAULT 0,
    outcome TEXT,                                  -- 'yes' | 'no' | null (unresolved)
    resolution_source TEXT,                       -- UMA oracle / official source
    end_date TIMESTAMPTZ,
    safety_score INTEGER,                          -- 0-100 Market Safety Score
    safety_details JSONB,                          -- breakdown of safety components
    matched_market_id UUID REFERENCES markets(id), -- cross-platform equivalent
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(platform, platform_id)
);

-- Tracked wallet profiles (Polymarket wallets)
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address TEXT NOT NULL UNIQUE,                  -- proxy wallet address
    proxy_address TEXT,                            -- proxy wallet if different
    pseudonym TEXT,                                 -- Polymarket username
    profile_image TEXT,
    x_username TEXT,                                -- Twitter/X handle
    is_verified BOOLEAN DEFAULT false,
    tags TEXT[] DEFAULT '{}',                       -- ['whale', 'insider', 'kol', 'smart_money']
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Smart money scoring (updated periodically)
CREATE TABLE wallet_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    period TEXT NOT NULL,                           -- '7d' | '30d' | '90d' | 'all'
    total_pnl NUMERIC NOT NULL DEFAULT 0,
    total_volume NUMERIC NOT NULL DEFAULT 0,
    win_rate NUMERIC,                              -- 0.0 to 1.0
    total_markets INTEGER DEFAULT 0,
    winning_markets INTEGER DEFAULT 0,
    avg_position_size NUMERIC,
    roi NUMERIC,                                   -- return on investment %
    sharpe_ratio NUMERIC,
    smart_score INTEGER,                           -- -100 to 100 (like Hashdive)
    category_expertise JSONB,                      -- { politics: 0.78, sports: 0.62, ... }
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(wallet_id, period)
);

-- Individual trades (from Polymarket Data API + on-chain)
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL,
    market_id UUID REFERENCES markets(id),
    wallet_id UUID REFERENCES wallets(id),
    wallet_address TEXT,
    side TEXT NOT NULL,                             -- 'BUY' | 'SELL'
    outcome TEXT NOT NULL,                          -- 'YES' | 'NO'
    price NUMERIC NOT NULL,
    size NUMERIC NOT NULL,                          -- USDC amount
    token_amount NUMERIC,                          -- shares amount
    tx_hash TEXT,
    is_whale BOOLEAN DEFAULT false,                -- flagged if size > threshold
    platform_timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current positions per wallet per market
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    market_id UUID NOT NULL REFERENCES markets(id),
    outcome TEXT NOT NULL,                          -- 'YES' | 'NO'
    size NUMERIC NOT NULL,                          -- number of shares
    avg_price NUMERIC NOT NULL,
    initial_value NUMERIC NOT NULL,
    current_value NUMERIC,
    unrealized_pnl NUMERIC,
    unrealized_pnl_pct NUMERIC,
    realized_pnl NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(wallet_id, market_id, outcome)
);

-- ═══ FEATURES ═══

-- User alert configurations
CREATE TABLE alert_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,                         -- session ID or registered user
    alert_type TEXT NOT NULL,                       -- whale_trade | new_market | price_move | arb
    config JSONB NOT NULL,                          -- { min_size: 10000, wallets: [...], categories: [...] }
    delivery TEXT NOT NULL DEFAULT 'web',           -- web | telegram | both
    telegram_chat_id TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Copy trade configurations
CREATE TABLE copy_trade_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    target_wallet_id UUID NOT NULL REFERENCES wallets(id),
    sizing_mode TEXT NOT NULL DEFAULT 'fixed',      -- 'fixed' | 'proportional'
    fixed_amount NUMERIC,                           -- USDC per trade (if fixed)
    proportional_pct NUMERIC,                       -- % of target size (if proportional)
    max_per_trade NUMERIC,
    max_per_market NUMERIC,
    min_market_safety INTEGER DEFAULT 50,           -- skip markets below this safety score
    category_filter TEXT[],                          -- only copy certain categories
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Copy trade execution log
CREATE TABLE copy_trade_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES copy_trade_configs(id),
    source_trade_id UUID REFERENCES trades(id),
    market_id UUID REFERENCES markets(id),
    side TEXT NOT NULL,
    outcome TEXT NOT NULL,
    price NUMERIC NOT NULL,
    size NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',          -- pending | executed | failed
    error_message TEXT,
    tx_hash TEXT,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Market Safety Score history
CREATE TABLE market_safety_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id),
    overall_score INTEGER NOT NULL,                  -- 0-100
    liquidity_score INTEGER NOT NULL,                -- 0-25
    resolution_score INTEGER NOT NULL,               -- 0-25
    manipulation_score INTEGER NOT NULL,             -- 0-25
    structural_score INTEGER NOT NULL,               -- 0-25
    details JSONB NOT NULL,                           -- full breakdown
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cross-platform arbitrage opportunities
CREATE TABLE arbitrage_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_a_id UUID NOT NULL REFERENCES markets(id),
    market_b_id UUID NOT NULL REFERENCES markets(id),
    price_a NUMERIC NOT NULL,                        -- YES price on platform A
    price_b NUMERIC NOT NULL,                        -- YES price on platform B
    spread NUMERIC NOT NULL,                         -- absolute price difference
    spread_pct NUMERIC NOT NULL,                     -- percentage spread
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expired_at TIMESTAMPTZ                           -- null if still active
);

-- User sessions (anonymous)
CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trades_market ON trades(market_id);
CREATE INDEX idx_trades_wallet ON trades(wallet_id);
CREATE INDEX idx_trades_whale ON trades(is_whale) WHERE is_whale = true;
CREATE INDEX idx_trades_timestamp ON trades(platform_timestamp DESC);
CREATE INDEX idx_positions_wallet ON positions(wallet_id);
CREATE INDEX idx_positions_market ON positions(market_id);
CREATE INDEX idx_markets_platform ON markets(platform, platform_id);
CREATE INDEX idx_markets_category ON markets(category);
CREATE INDEX idx_markets_safety ON markets(safety_score);
CREATE INDEX idx_wallet_scores_smart ON wallet_scores(smart_score DESC);
CREATE INDEX idx_arb_active ON arbitrage_opportunities(expired_at) WHERE expired_at IS NULL;
```

### Redis Keys

```
-- Real-time market prices
market:{platform}:{id}:price     → JSON { yes: 0.42, no: 0.58, volume: 1234567 }

-- Live whale trade feed (last 100 trades)
feed:whale_trades                → List (LPUSH + LTRIM 100)

-- Wallet activity tracking
wallet:{address}:last_trade      → JSON { market, side, size, timestamp }

-- Leaderboard
leaderboard:pnl:7d               → Sorted Set { walletId → pnl }
leaderboard:pnl:30d              → Sorted Set { walletId → pnl }
leaderboard:winrate              → Sorted Set { walletId → winRate }

-- Arbitrage opportunities (active)
arb:active                       → Set of arb IDs

-- Rate limiting
ratelimit:{ip}                   → Counter with TTL

-- Cache
cache:market:{id}                → JSON (market details, 60s TTL)
cache:wallet:{addr}:positions    → JSON (positions, 30s TTL)
```

---

## Market Safety Score (0-100)

Our unique feature — a composite risk score for every prediction market:

```
┌────────────────────────────────────────────────────────────┐
│  MARKET SAFETY SCORE                                        │
│                                                             │
│  ┌─── Liquidity Health (0-25 points) ──────────────────┐   │
│  │  • Bid-ask spread tightness                          │   │
│  │  • Order book depth ($10K+ on each side?)            │   │
│  │  • Volume-to-liquidity ratio                         │   │
│  │  • Can you exit a $1K position without >2% slippage? │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Resolution Integrity (0-25 points) ──────────────┐   │
│  │  • Clear, unambiguous resolution criteria?            │   │
│  │  • Reliable data source (BLS, official results, etc.) │   │
│  │  • History of disputes on similar markets?            │   │
│  │  • Oracle track record (UMA dispute history)          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Manipulation Risk (0-25 points) ─────────────────┐   │
│  │  • Whale concentration (top 5 holders % of YES/NO)    │   │
│  │  • Suspicious new wallets with large positions?       │   │
│  │  • Coordinated wallet clusters detected?              │   │
│  │  • Single-sided volume anomalies?                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Structural Risk (0-25 points) ───────────────────┐   │
│  │  • Time to resolution (longer = riskier)              │   │
│  │  • Market creator reputation                          │   │
│  │  • Similar markets resolved correctly before?         │   │
│  │  • Platform (Polymarket has oracle risk, Kalshi does   │   │
│  │    not but has platform risk)                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  TOTAL: sum of 4 components = 0-100                         │
│                                                             │
│  90-100: Very Safe    │  60-89: Moderate                    │
│  40-59: Risky         │  0-39: Dangerous                    │
└────────────────────────────────────────────────────────────┘
```

---

## Smart Money Scoring (Smart Score: -100 to +100)

How we identify and rank "smart money" wallets:

```
INPUTS (from Polymarket Data API):
  • Trade history (GET /trades?user={wallet})
  • Position outcomes (GET /positions?user={wallet})
  • Activity timeline (GET /activity?user={wallet})
  • Leaderboard rank (GET /v1/leaderboard?user={wallet})

SCORING FORMULA:
  ┌─────────────────────────────────────────────────────┐
  │  Win Rate Score (40% weight)                        │
  │    = (winning_markets / total_markets) × 100        │
  │    Adjusted for market difficulty                   │
  │    (winning a 90% market = low skill,               │
  │     winning a 30% market = high skill)              │
  │                                                     │
  │  ROI Score (30% weight)                             │
  │    = annualized return on capital deployed           │
  │    Compared to platform average                     │
  │                                                     │
  │  Consistency Score (20% weight)                     │
  │    = Sharpe ratio of returns                        │
  │    High = consistent profits                        │
  │    Low = lucky one-time wins                        │
  │                                                     │
  │  Volume Score (10% weight)                          │
  │    = Higher volume = more data points = more        │
  │      confidence in the score                        │
  │                                                     │
  │  SMART SCORE = weighted sum, normalized to [-100, 100]│
  └─────────────────────────────────────────────────────┘

TAGS:
  Score 80-100:  "Elite Trader"     (top 1%)
  Score 60-79:   "Smart Money"      (top 5%)
  Score 40-59:   "Skilled Trader"   (top 15%)
  Score 0-39:    "Active Trader"
  Score < 0:     "Losing Trader"
```

---

## Frontend Pages

### Page 1: Dashboard (`/`)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  MarkyPie                     [Search markets...]    🔔 Alerts  [Login] │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─── LIVE WHALE FEED ──────────────────────────────────────────────┐   │
│  │  🐋 0x7f3a.. bought $45K YES on "Fed cuts March 2026" at $0.22  │   │
│  │     Smart Score: 87 │ Win Rate: 74% │ 2 min ago                  │   │
│  │  🐋 PolyTrader99 sold $12K NO on "BTC > $200K Dec 2026" at $0.81│   │
│  │     Smart Score: 63 │ Win Rate: 58% │ 5 min ago                  │   │
│  │  🐋 0x9b2c.. bought $100K YES on "Trump wins 2028" at $0.31     │   │
│  │     Smart Score: 92 │ Win Rate: 81% │ 8 min ago                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─── TRENDING MARKETS ───────────────────┐ ┌─── NEW MARKETS ────────┐ │
│  │                                         │ │                        │ │
│  │  "Fed Chair Nominee"         Vol: $173M │ │  "Oscar Best Picture"  │ │
│  │  YES: Warsh $0.94 ▲ +2.1%   Safety: 88 │ │  Created: 2 hrs ago   │ │
│  │  🐋 3 whales entered today              │ │  Volume: $45K         │ │
│  │                                         │ │  Safety: 72           │ │
│  │  "BTC > $150K by June"      Vol: $8.2M  │ │                        │ │
│  │  YES: $0.35 ▼ -4.3%        Safety: 91  │ │  "India PM by 2027"   │ │
│  │  🐋 Smart money: 68% YES               │ │  Created: 5 hrs ago   │ │
│  │                                         │ │  Volume: $12K         │ │
│  │  "Fed cuts March 2026"      Vol: $2.1M  │ │  Safety: 65           │ │
│  │  YES: $0.22 ▲ +1.5%        Safety: 85  │ │                        │ │
│  │  🐋 1 whale bought $45K YES             │ │                        │ │
│  └─────────────────────────────────────────┘ └────────────────────────┘ │
│                                                                          │
│  ┌─── ARBITRAGE OPPORTUNITIES ──────────────────────────────────────┐   │
│  │                                                                   │   │
│  │  "Fed cuts March 2026?"                                           │   │
│  │    Polymarket YES: $0.22  │  Kalshi YES: $0.25  │  Spread: 3¢    │   │
│  │                                                                   │   │
│  │  "BTC > $100K end of Feb?"                                        │   │
│  │    Polymarket YES: $0.88  │  Kalshi YES: $0.85  │  Spread: 3¢    │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─── LEADERBOARD (Top Smart Money) ────────────────────────────────┐   │
│  │  Rank │ Trader        │ Score │ 30d PnL  │ Win Rate │ Volume     │   │
│  │  1    │ @PolyWhale    │  94   │ +$340K   │ 81%      │ $2.1M      │   │
│  │  2    │ 0x7f3a..      │  87   │ +$185K   │ 74%      │ $1.4M      │   │
│  │  3    │ @CryptoOracle │  82   │ +$92K    │ 69%      │ $890K      │   │
│  └───────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Page 2: Market Detail (`/market/:id`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  "Will Fed cut rates in March 2026?"                                  │
│  Polymarket │ Category: Economics │ Ends: Mar 20, 2026                │
│                                                                       │
│  ┌─── SAFETY SCORE: 85/100 ──────────────────────────────────────┐   │
│  │  Liquidity: 22/25  Resolution: 24/25  Manipulation: 18/25     │   │
│  │  Structural: 21/25                                             │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  YES: $0.22 (22%)        NO: $0.78 (78%)        Volume: $2.1M        │
│                                                                       │
│  ┌─── ODDS CHART (Lightweight Charts) ────────────────────────────┐  │
│  │                                                                 │  │
│  │  $0.30 ─                                                        │  │
│  │  $0.25 ─              ╱╲                                        │  │
│  │  $0.20 ─   ╱╲    ╱╲╱╲╱  ╲╱╲   ← current                       │  │
│  │  $0.15 ─  ╱  ╲╱╲╱            ╲                                  │  │
│  │  $0.10 ─ ╱                                                      │  │
│  │         └──────────────────────────────────────────────────────  │  │
│  │         Jan 15     Jan 22     Jan 29     Feb 5     Feb 12       │  │
│  │                                                                 │  │
│  │  🐋 markers showing where whales entered/exited                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─── WHALE POSITIONS ────────┐ ┌─── SMART MONEY CONSENSUS ──────┐  │
│  │                             │ │                                 │  │
│  │  @PolyWhale (Score: 94)     │ │  Smart Money YES: 68%          │  │
│  │    YES 50,000 shares @ $0.18│ │  Smart Money NO:  32%          │  │
│  │    Unrealized: +$2,000      │ │                                 │  │
│  │                             │ │  ██████████████░░░░░░ 68% YES   │  │
│  │  0x7f3a.. (Score: 87)       │ │                                 │  │
│  │    YES 200,000 shares @$0.22│ │  Whales accumulated $340K YES   │  │
│  │    Unrealized: +$0          │ │  in the last 7 days             │  │
│  │                             │ │                                 │  │
│  │  0xabc1.. (Score: 71)       │ │  Retail is 55% YES, 45% NO     │  │
│  │    NO 30,000 shares @ $0.75 │ │  (Smart money diverges from     │  │
│  │    Unrealized: +$900        │ │   retail by +13% on YES side)   │  │
│  └─────────────────────────────┘ └─────────────────────────────────┘  │
│                                                                       │
│  ┌─── CROSS-PLATFORM ────────────────────────────────────────────┐   │
│  │  Same question on Kalshi: KXFEDRATE-MAR26                      │   │
│  │  Kalshi YES: $0.25  │  Polymarket YES: $0.22  │  Spread: 3¢    │   │
│  └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### Page 3: Wallet Profile (`/wallet/:address`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  🐋 @PolyWhale                                      Smart Score: 94  │
│  0x7f3a...9b2c │ Verified │ @polywhale_x                             │
│                                                                       │
│  ┌─── STATS ─────────────────────────────────────────────────────┐   │
│  │  30d PnL: +$340,210  │  Win Rate: 81%  │  Markets: 47         │   │
│  │  Total Volume: $2.1M │  Sharpe: 2.4    │  Avg Position: $44K  │   │
│  │                                                                │   │
│  │  Category Expertise:                                           │   │
│  │    Politics: ██████████████████ 89%                            │   │
│  │    Economics: ████████████████ 78%                              │   │
│  │    Sports:    ███████████ 55%                                   │   │
│  │    Crypto:    ████████████████ 76%                              │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  [🔔 Follow Wallet]  [📋 Copy Trade]                                  │
│                                                                       │
│  ┌─── CURRENT POSITIONS ─────────────────────────────────────────┐   │
│  │  Market                    │ Side │ Size    │ Entry │ PnL      │   │
│  │  Fed cuts March 2026       │ YES  │ $44K    │ $0.18 │ +$8.8K   │   │
│  │  Trump wins 2028           │ YES  │ $31K    │ $0.28 │ +$9.3K   │   │
│  │  BTC > $200K Dec 2026      │ NO   │ $22K    │ $0.82 │ -$2.2K   │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─── RECENT TRADES ────────────────────────────────────────────┐    │
│  │  Time     │ Market               │ Action   │ Size   │ Price │    │
│  │  2m ago   │ Fed cuts March       │ BUY YES  │ $45K   │ $0.22 │    │
│  │  1h ago   │ Oscar Best Picture   │ SELL NO  │ $8K    │ $0.65 │    │
│  │  3h ago   │ BTC > $150K June     │ BUY YES  │ $15K   │ $0.33 │    │
│  └───────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### Page 4: Copy Trading (`/copy-trade`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Copy Trading                                                         │
│                                                                       │
│  ┌─── TOP TRADERS TO COPY ───────────────────────────────────────┐   │
│  │                                                                │   │
│  │  @PolyWhale │ Score: 94 │ 30d: +$340K │ Win: 81%  [COPY]      │   │
│  │  0x7f3a..   │ Score: 87 │ 30d: +$185K │ Win: 74%  [COPY]      │   │
│  │  @CryptoOrc │ Score: 82 │ 30d: +$92K  │ Win: 69%  [COPY]      │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─── CONFIGURE COPY TRADE ──────────────────────────────────────┐   │
│  │                                                                │   │
│  │  Wallet: @PolyWhale (0x7f3a...)                                │   │
│  │                                                                │   │
│  │  Sizing: [Fixed Amount ▼]                                      │   │
│  │  Amount per trade: [$50 USDC]                                  │   │
│  │  Max per market:   [$200 USDC]                                 │   │
│  │                                                                │   │
│  │  Filters:                                                      │   │
│  │    Min Safety Score: [50 ──●────── 100]                        │   │
│  │    Categories: [✓ Politics] [✓ Economics] [✓ Crypto] [□ Sports]│   │
│  │                                                                │   │
│  │  [▶ START COPY TRADING]                                        │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─── ACTIVE COPY TRADES ────────────────────────────────────────┐   │
│  │  Following @PolyWhale since Feb 15                             │   │
│  │  Trades copied: 4 │ PnL: +$12.50 │ Status: Active             │   │
│  │  [PAUSE] [STOP]                                                │   │
│  └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation + Data Pipeline (Week 1-2)

| Task | Details |
|---|---|
| Project scaffold | Next.js 15 + TypeScript + Tailwind + monorepo setup |
| Database setup | PostgreSQL schema + Redis + Docker Compose + migrations |
| Polymarket data sync | Gamma API (markets/events) → PostgreSQL, scheduled every 5 min |
| Kalshi data sync | REST API (markets/events) → PostgreSQL, scheduled every 5 min |
| Trade ingestion (Polymarket) | Data API polling for recent trades, whale detection (>$10K) |
| On-chain indexer (basic) | Listen to CTF Exchange `OrderFilled` events for real-time whale detection |
| Wallet discovery | Seed top 100 wallets from Polymarket leaderboard API |
| Market matching | Basic fuzzy matching to link same questions across platforms |

### Phase 2: Intelligence Layer (Week 3-4)

| Task | Details |
|---|---|
| Smart Money scoring | Calculate Smart Score for all tracked wallets (win rate, ROI, Sharpe) |
| Market Safety Score | Implement 4-component scoring (liquidity, resolution, manipulation, structural) |
| Whale trade detection | Flag trades >$10K, classify whale vs retail |
| Position tracking | Sync wallet positions from Data API, calculate unrealized PnL |
| Arbitrage detector | Compare matched markets across Polymarket + Kalshi, flag spreads >2% |
| Smart money consensus | Per market: what % of smart money is YES vs NO |
| Category expertise | Track per-wallet performance by category |

### Phase 3: Frontend - Dashboard + Market Detail (Week 5-6)

| Task | Details |
|---|---|
| Dashboard page | Trending markets, new markets, live whale feed, leaderboard |
| Market detail page | Odds chart (LW Charts), safety score, whale positions, smart money consensus |
| Wallet profile page | Stats, positions, trade history, category expertise |
| WebSocket live feed | Real-time whale trades streamed to dashboard |
| Search | Full-text search across all markets |
| Charts | Lightweight Charts v5 with whale trade markers overlaid |

### Phase 4: Alerts + Copy Trading (Week 7-8)

| Task | Details |
|---|---|
| Alert configuration UI | Set up whale trade alerts, price movement alerts, new market alerts |
| Telegram bot | Deliver alerts via Telegram (grammy library) |
| Copy trade config UI | Select wallet, set sizing, filters, start/stop |
| Copy trade engine | Poll target wallet positions, detect new trades, execute via CLOB API |
| Copy trade execution log | Track all copied trades, PnL per copy config |
| WebSocket alerts | Push alerts to browser in real-time |

### Phase 5: Polish + Launch (Week 9-10)

| Task | Details |
|---|---|
| Responsive/mobile design | Mobile-first for whale feed and alerts |
| Performance optimization | Virtualized lists, query optimization, Redis caching |
| Error handling | API error boundaries, WS reconnection, retry logic |
| Dark theme polish | Trading-terminal aesthetic |
| Deployment | Vercel (frontend) + Railway (backend + PG + Redis) |
| Monitoring | Error tracking, API health checks, data freshness alerts |
| Landing page | Marketing page explaining the value prop |

---

## Project Structure

```
markypie-gmgn-prediction-market/
├── apps/
│   ├── web/                              # Next.js 15 frontend
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                  # Dashboard
│   │   │   ├── market/
│   │   │   │   └── [id]/page.tsx         # Market detail
│   │   │   ├── wallet/
│   │   │   │   └── [address]/page.tsx    # Wallet profile
│   │   │   ├── copy-trade/
│   │   │   │   └── page.tsx              # Copy trading
│   │   │   ├── leaderboard/
│   │   │   │   └── page.tsx              # Full leaderboard
│   │   │   ├── alerts/
│   │   │   │   └── page.tsx              # Alert configuration
│   │   │   └── api/                      # Next.js API routes (proxy)
│   │   ├── components/
│   │   │   ├── dashboard/
│   │   │   │   ├── WhaleFeed.tsx         # Live whale trade feed
│   │   │   │   ├── TrendingMarkets.tsx
│   │   │   │   ├── NewMarkets.tsx
│   │   │   │   ├── ArbitragePanel.tsx
│   │   │   │   └── MiniLeaderboard.tsx
│   │   │   ├── market/
│   │   │   │   ├── OddsChart.tsx         # LW Charts + whale markers
│   │   │   │   ├── SafetyScore.tsx       # Visual safety breakdown
│   │   │   │   ├── WhalePositions.tsx    # Whale position table
│   │   │   │   ├── SmartMoneyConsensus.tsx
│   │   │   │   └── CrossPlatform.tsx     # Cross-platform comparison
│   │   │   ├── wallet/
│   │   │   │   ├── WalletStats.tsx
│   │   │   │   ├── PositionsTable.tsx
│   │   │   │   ├── TradeHistory.tsx
│   │   │   │   └── CategoryExpertise.tsx
│   │   │   ├── copy-trade/
│   │   │   │   ├── TraderSelector.tsx
│   │   │   │   ├── CopyConfig.tsx
│   │   │   │   └── ActiveCopies.tsx
│   │   │   ├── alerts/
│   │   │   │   ├── AlertConfig.tsx
│   │   │   │   └── AlertHistory.tsx
│   │   │   └── shared/
│   │   │       ├── Header.tsx
│   │   │       ├── SearchBar.tsx
│   │   │       ├── SmartScoreBadge.tsx
│   │   │       ├── SafetyBadge.tsx
│   │   │       └── PlatformIcon.tsx
│   │   ├── hooks/
│   │   │   ├── useWhaleFeed.ts           # WebSocket whale trade stream
│   │   │   ├── useMarketData.ts
│   │   │   ├── useWalletData.ts
│   │   │   └── useAuth.ts
│   │   └── lib/
│   │       ├── api-client.ts
│   │       └── ws-client.ts
│   │
│   └── server/                           # Node.js backend
│       ├── src/
│       │   ├── index.ts                  # Entry point
│       │   ├── ingestion/
│       │   │   ├── polymarket-sync.ts    # Gamma + Data API sync
│       │   │   ├── kalshi-sync.ts        # Kalshi REST API sync
│       │   │   ├── trade-ingestion.ts    # Trade polling + whale detection
│       │   │   ├── chain-indexer.ts      # Polygon on-chain event listener
│       │   │   └── market-matcher.ts     # Cross-platform market matching
│       │   ├── intelligence/
│       │   │   ├── smart-score.ts        # Wallet Smart Score calculation
│       │   │   ├── market-safety.ts      # Market Safety Score calculation
│       │   │   ├── whale-detector.ts     # Whale trade classification
│       │   │   ├── arbitrage.ts          # Cross-platform arb detection
│       │   │   └── consensus.ts          # Smart money consensus per market
│       │   ├── copy-trade/
│       │   │   ├── engine.ts             # Copy trade execution engine
│       │   │   ├── position-monitor.ts   # Target wallet position polling
│       │   │   └── executor.ts           # CLOB API order execution
│       │   ├── alerts/
│       │   │   ├── alert-engine.ts       # Alert evaluation + dispatch
│       │   │   └── telegram-bot.ts       # Telegram alert delivery
│       │   ├── ws/
│       │   │   ├── broadcaster.ts        # WebSocket server + broadcasting
│       │   │   └── protocol.ts           # Message types
│       │   ├── api/
│       │   │   ├── routes.ts             # REST endpoints
│       │   │   └── middleware.ts         # Auth, rate limiting
│       │   └── db/
│       │       ├── postgres.ts
│       │       ├── redis.ts
│       │       └── migrations/
│       └── scripts/
│           ├── seed-leaderboard.ts       # Seed top wallets from Polymarket
│           ├── backfill-trades.ts        # Backfill historical trade data
│           └── calculate-scores.ts       # Recalculate all Smart Scores
│
├── packages/
│   └── shared/                           # Shared TypeScript types
│       ├── types.ts                      # Market, Wallet, Trade, Position types
│       └── constants.ts                  # Platforms, categories, thresholds
│
├── docker-compose.yml                    # PostgreSQL + Redis for local dev
├── package.json
├── tsconfig.json
└── PLAN.md
```

---

## Revenue Model

| Stream | How It Works | Timeline |
|---|---|---|
| **Free Tier** | Dashboard, top 10 whale feed, basic market data, 3 alert configs | Launch |
| **Pro ($29/mo)** | Full whale feed, unlimited alerts, Smart Scores, 10 wallet follows | Month 2 |
| **Premium ($79/mo)** | Copy trading, arbitrage scanner, Telegram bot, API access, Market Safety Scores | Month 3 |
| **API Access ($199/mo)** | Full data API for algo traders and researchers | Month 4 |
| **Referral fees** | Earn commission when users trade on Polymarket via our referral links | Launch |

---

## Key Technical Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| **Polymarket-first** | Primary platform | Fully on-chain = full wallet transparency, rich APIs, larger ecosystem |
| **Kalshi as secondary** | Aggregation + arbitrage | No wallet transparency, but valuable for cross-platform arb detection |
| **No blockchain for our platform** | Traditional server architecture | We're an analytics tool, not a trading platform. No need for smart contracts |
| **Polling + WebSocket hybrid** | Not pure on-chain indexing | Polymarket APIs provide richer data than raw contract events. Use on-chain for real-time, API for enrichment |
| **PostgreSQL + Redis** | Dual-layer storage | PG for durable analytics data, Redis for real-time feeds and caching |
| **Start with Polymarket Data API** | Not raw on-chain indexing | The Data API already provides trades, positions, and leaderboard. On-chain is a supplement for speed, not the primary source |
| **Anonymous auth (MVP)** | JWT sessions, no signup | Zero friction for browsing. Require login only for copy trading / alerts |
| **grammy for Telegram** | Not Telegraf | More modern, better TypeScript support, active maintenance |
