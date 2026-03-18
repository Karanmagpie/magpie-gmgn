# MarkyPie — Project Context

## What This Project Is

**MarkyPie** is a GMGN.ai-style platform for prediction markets (Polymarket + Kalshi).

GMGN.ai tracks smart money, whale wallets, and provides copy trading for memecoins on Solana/ETH. MarkyPie applies the same concept to prediction markets — tracking whale wallets on Polymarket, detecting large trades on Kalshi, providing copy trading, Market Safety Scores, arbitrage detection, and real-time alerts.

## Key Documents

- `MARKYPIE_DOC.md` — Clean, structured product document (Problem Statement, Solution, Revenue Model, MVP Plan with all frontend features). Presentation-ready version.
- `MARKYPIE_DOC_PLAINTEXT.txt` — Plain text version of the product doc.
- `PLAN.md` — Deep technical plan with full architecture diagrams, complete PostgreSQL schema, Redis key structure, all API endpoints documented, ASCII wireframes for every page, project folder structure, and implementation phases.
- `GMGN_TO_PREDICTION_MARKETS_MAPPING.md` — Detailed research mapping all 10 GMGN features to prediction market equivalents with 80+ source links.

## Research Completed

1. **GMGN.ai** — Full understanding: smart money tracking, sniper bots, copy trading, token security, anti-MEV, fee structure, architecture, user flow, PumpFun/Moonshot integration
2. **Polymarket** — Full understanding: Gnosis CTF (ERC-1155), hybrid CLOB (off-chain matching + on-chain settlement), UMA Optimistic Oracle, NegRisk adapter, all APIs (Gamma, Data, CLOB, WebSockets), on-chain contracts on Polygon, price discovery (YES + NO = $1)
3. **Kalshi** — Full understanding: CFTC-regulated, centralized (NOT crypto — pure USD internally), FDIC insured, variable fees (1-5.6%), RSA key auth, anonymous trades (no wallet transparency), REST + WebSocket APIs
4. **Feature Translation** — Which GMGN features apply:
   - Works perfectly: Smart Money Tracking, Position Analysis, Alerts, Leaderboard, Cross-Platform
   - Works but different: Copy Trading (Polymarket only), New Market Scanner (lower volume), Execution Quality
   - Does NOT translate: Sniper Bot, Anti-MEV, Bundled Wallet Detection
   - NEW opportunities: Cross-platform arbitrage, Market Safety Score, Smart vs Retail divergence
5. **Competitive Landscape** — 170+ fragmented tools exist (PolyTrack, Hashdive, Polysights, Unusual Predictions, Oddpool, 0xInsider) but none combine all features into one product

## Tech Stack

- Node.js 22 + TypeScript, Next.js 15 + React 19, Tailwind CSS 4
- **Hono** — API framework (3x faster than Express), replaces raw http server
- TradingView Lightweight Charts v5
- PostgreSQL 17 (Neon DB — serverless, production) + Redis 7 (ioredis), BullMQ
- ws (WebSocket server), react-use-websocket (client)
- Polygon RPC + ethers.js (on-chain indexing)
- grammy (Telegram bot), @polymarket/clob-client (copy trading)
- JWT auth (anonymous sessions for MVP)

## Implementation Timeline

5 phases, 10 weeks:
1. Foundation + Data Pipeline (Week 1-2) ✅ COMPLETE
2. Intelligence Layer — Smart Score + Market Safety Score (Week 3-4) ✅ COMPLETE
3. Frontend — Dashboard + Market Detail + Wallet Profile (Week 5-6) ✅ COMPLETE (structure built)
4. Alerts + Copy Trading (Week 7-8) ← NEXT
5. Polish + Launch (Week 9-10)

## Revenue Model

Free → Pro $29/mo → Premium $79/mo → API $199/mo + referral fees

## Important Notes

- Kalshi has NO wallet/user transparency — smart money tracking only works on Polymarket. Kalshi is useful for cross-platform aggregation and arbitrage only.
- Copy trading only works on Polymarket (on-chain execution via CLOB API). Kalshi is centralized and anonymous.
- The user refers to the project as "MarkyPie".
- User's communication style is casual ("bro").
- User wants detailed explanations for every file, API, SDK, and decision during implementation.
- User explicitly requested BullMQ over node-cron for production-grade job scheduling.
- User setup: Windows 11 Home, npm (not pnpm/yarn).
- Docker Desktop CANNOT run — Windows 11 Home lacks Hyper-V, user refuses WSL2.
- **Local dev**: PostgreSQL 18 natively + Memurai (Redis for Windows) on port 6379.
- Local PostgreSQL: user `postgres`, password `markypie`, database `markypie`, port 5432.
- **Production DB**: Neon DB (PostgreSQL 17), AWS US East 1 (N. Virginia) — switched from Railway Postgres which kept crashing.
- User requirement: "first have my setup, then do steps, we need to test each step then we move forward"

## Deployment

- **Backend**: Railway (Node.js server)
- **Database**: Neon DB (PostgreSQL 17, serverless) — replaced Railway Postgres which was crashing
  - Project: `markypie`, Region: AWS US East 1 (N. Virginia) — matches Railway US East region
- **Redis**: Upstash or Railway Redis (TLS-enabled ioredis connection already configured)
- **Frontend**: Vercel (Next.js — `vercel.json` present in root)

## Folder Structure

```
markypie-gmgn-prediction-market/
├── PLAN.md, MARKYPIE_DOC.md, GMGN_TO_PREDICTION_MARKETS_MAPPING.md
├── CLAUDE.md, vercel.json, package.json, tsconfig.json, .env, .env.example
│
├── packages/shared/src/
│   ├── types.ts          (all entity types: Market, Wallet, Trade, Position, etc.)
│   ├── constants.ts      (platforms, thresholds, Redis keys, API URLs, contracts)
│   └── index.ts          (barrel export)
│
├── apps/server/src/
│   ├── index.ts          (main entry — BullMQ orchestration, all job scheduling)
│   ├── api.ts            (Hono app — CORS, routes, /health)
│   ├── config/env.ts     (env var validation)
│   ├── utils/logger.ts   (pino + pino-pretty)
│   ├── db/
│   │   ├── postgres.ts   (pg Pool max 5 for free tier, migrations runner)
│   │   ├── redis.ts      (ioredis, TLS support for Railway/Upstash)
│   │   └── migrations/
│   │       ├── 001_initial_schema.sql   (11 tables + 13 indexes)
│   │       ├── 002_phase2_schema.sql    (performance indexes for intelligence layer)
│   │       └── 003_score_breakdown.sql  (win_rate_score, roi_score, consistency_score, volume_score columns)
│   ├── ingestion/        (Phase 1 — Data Pipeline)
│   │   ├── polymarket-sync.ts    (Gamma API → markets)
│   │   ├── polymarket-trades.ts  (Data API → trades + whale detection)
│   │   ├── polymarket-wallets.ts (Leaderboard → wallets)
│   │   ├── polymarket-ws.ts      (CLOB WebSocket → real-time prices)
│   │   ├── chain-indexer.ts      (Polygon RPC → OrderFilled events, disabled for MVP)
│   │   ├── kalshi-sync.ts        (Kalshi REST API → markets)
│   │   └── market-matcher.ts     (Jaccard fuzzy match + arbitrage detection)
│   ├── intelligence/     (Phase 2 — Scoring Engine)
│   │   ├── smart-score.ts        (wallet scores -100 to +100, 4 components)
│   │   ├── market-safety.ts      (market safety 0-100, 4 components)
│   │   ├── position-tracker.ts   (trades → positions aggregation)
│   │   ├── wallet-enrichment.ts  (backfill trade history per wallet)
│   │   └── consensus.ts          (smart money YES/NO % per market)
│   └── routes/           (Phase 2 — REST API)
│       ├── markets.ts        (GET /api/markets, /api/markets/:id, /api/markets/:id/trades)
│       ├── wallets.ts        (GET /api/wallets, /:address, /:address/positions, /:address/trades)
│       ├── trades.ts         (GET /api/trades)
│       └── intelligence.ts   (GET /api/intelligence/consensus/:id, /arbitrage, /smart-money)
│
└── apps/web/
    ├── app/
    │   ├── layout.tsx              (root layout + dark theme + sidebar)
    │   ├── page.tsx                (dashboard)
    │   ├── markets/page.tsx        (markets list)
    │   ├── markets/[id]/page.tsx   (market detail)
    │   ├── wallets/page.tsx        (leaderboard)
    │   ├── wallets/[address]/page.tsx (wallet profile)
    │   └── arbitrage/page.tsx      (arbitrage opportunities)
    ├── components/
    │   ├── sidebar.tsx             (nav: Dashboard, Markets, Leaderboard, Arbitrage)
    │   └── dashboard/
    │       ├── whale-feed.tsx
    │       ├── trending-markets.tsx
    │       ├── leaderboard-preview.tsx
    │       └── arbitrage-card.tsx
    └── lib/
        ├── api.ts      (typed fetch wrapper for all API endpoints)
        └── format.ts   (utility functions)
```

## Phase 1 — COMPLETE ✅

All 12 steps coded + TypeScript compiles clean. Fully tested:

- **Polymarket Market Sync**: 46,949 markets from Gamma API
- **Kalshi Market Sync**: 178,613 markets (cursor pagination). Total: 225,562 markets.
- **Trade Ingestion**: 2,700+ trades ingested. Whale detection working.
  - Whale examples: $169,803 ultra whale, $15,114 whale
  - All pushed to Redis `feed:whale_trades`
- **Wallet Discovery**: 651 wallets (DrPufferfish, elkmonkey, c4c4, PeterSagan, etc.)
- **Cross-Platform Matching**: 54 markets matched (27 pairs) — Jaccard @ 0.55 threshold
- **Chain Indexer**: Connected to Polygon via PublicNode RPC (`polygon-bor-rpc.publicnode.com`)
- **WebSocket**: Connected to Polymarket CLOB WebSocket, subscription format fixed

### Critical API Field Mappings (Fixed Bugs):

**Polymarket Data API `/trades`:**
```
proxyWallet, side, asset, conditionId, size (number), price (number),
timestamp, title, outcome, outcomeIndex, transactionHash, name, pseudonym
```

**Polymarket Data API `/v1/leaderboard`:**
```
rank (string), proxyWallet, userName, xUsername, verifiedBadge, vol, pnl, profileImage
```

**Polymarket Gamma API `/events`:**
```
events[].markets[]: conditionId, question, outcomePrices (JSON string),
outcomes (JSON string), volumeNum, liquidityNum, endDate, active, closed
```

## Phase 2 — COMPLETE ✅

Intelligence layer fully built:

### Smart Score (-100 to +100 per wallet per period)
- **Win Rate** (40%): trade-level analysis (entry vs current price), confidence-scaled
- **ROI** (30%): PnL / volume from leaderboard
- **Consistency** (20%): Sharpe ratio of per-trade PnL variance
- **Volume** (10%): percentile rank
- Tags: Elite (80-100), Smart Money (60-79), Skilled (40-59), Active (0-39), Losing (<0)
- Confidence scaling: pulls toward neutral when trades < 30
- DB columns: win_rate_score, roi_score, consistency_score, volume_score, data_quality

### Market Safety Score (0-100 per market)
- Baseline: 50 points
- Four components (0-25 each): Liquidity, Resolution, Manipulation, Structural
- Risk flags subtract: Critical (15), High (8), Medium (4), Low (2)
- Trust flags add: High (8), Medium (4), Low (2)

### Position Tracker
- Aggregates trades → positions per (wallet, market, outcome)
- Calculates: total shares, avg entry price, initial_value, unrealized PnL
- Single efficient SQL UPSERT batch

### Wallet Enrichment
- Fetches 50 trades per wallet from Data API
- Rate limited: 150ms delay, 20 wallets per run (~2.75h for all 651)
- Redis TTL 24h per wallet (skip recently enriched)

### Smart Money Consensus
- JOIN positions × wallet_scores (score >= 60)
- Returns: yes_pct, no_pct, weighted_yes_pct, weighted_no_pct, smart_wallet_count, total_smart_value
- Redis TTL 5 min: `consensus:market:{market_id}`

### REST API (Hono on :3001)
- GET /api/markets (list, filters: platform/category/status/min_safety_score/sort, 60s Redis cache)
- GET /api/markets/:id (detail + consensus + matched_market)
- GET /api/markets/:id/trades
- GET /api/wallets (leaderboard, sort: smart_score/volume/roi/pnl, 60s cache)
- GET /api/wallets/:address (full profile, 4 period scores)
- GET /api/wallets/:address/positions
- GET /api/wallets/:address/trades
- GET /api/trades (feed, whale_only filter)
- GET /api/intelligence/consensus/:marketId
- GET /api/intelligence/arbitrage
- GET /api/intelligence/smart-money

## Phase 3 — COMPLETE (Structure) ✅

Frontend pages and components built (Next.js 15 App Router):

### Pages Built:
- `/` — Dashboard (whale feed, trending markets, arbitrage, leaderboard preview)
- `/markets` — Market list with filters
- `/markets/[id]` — Market detail (safety score breakdown, whale positions, smart money consensus, cross-platform comparison)
- `/wallets` — Leaderboard (sortable, time periods: 7d/30d/90d/all)
- `/wallets/[address]` — Wallet profile (smart score, stats, positions, trade history, copy trade button)
- `/arbitrage` — Cross-platform spreads

### Components:
- `sidebar.tsx` — Fixed nav (Dashboard, Markets, Leaderboard, Arbitrage)
- `dashboard/whale-feed.tsx` — Live whale trades
- `dashboard/trending-markets.tsx` — Top markets
- `dashboard/leaderboard-preview.tsx` — Top 10 traders
- `dashboard/arbitrage-card.tsx` — Cross-platform spreads

### Utilities:
- `lib/api.ts` — Typed fetch wrapper for all API endpoints
- `lib/format.ts` — Utility formatting functions

## Phase 4 — NEXT: Alerts + Copy Trading

## Database Schema

**3 Migrations | 11 Tables | 13+ Indexes**

| Table | Purpose |
|-------|---------|
| markets | Unified Polymarket/Kalshi markets (225K+) |
| wallets | Tracked traders (651 discovered) |
| wallet_scores | Smart scores per wallet × period (4 periods) |
| trades | Individual trades (2700+ and growing) |
| positions | Current holdings (aggregated from trades) |
| alert_configs | User alert rules |
| copy_trade_configs | Copy trading setups |
| copy_trade_executions | Log of copied trades |
| market_safety_scores | Safety score history |
| arbitrage_opportunities | Cross-platform spreads |
| sessions | JWT auth sessions |

## BullMQ Job Schedule

| Job | Interval | What It Does |
|-----|----------|-------------|
| market-sync | 5 min | Sync Polymarket + Kalshi markets |
| trade-sync | 1 min | Fetch new trades, detect whales |
| wallet-sync | 24 hours | Refresh leaderboard wallets |
| market-match | 10 min | Fuzzy match + arbitrage detection |
| wallet-enrichment | 5 min | Backfill 20 wallets' trade history |
| position-sync | 5 min | Recalculate positions |
| smart-score | 30 min | Recalculate wallet smart scores |
| safety-score | 10 min | Recalculate market safety scores |
| consensus | 2 min | Update smart money consensus |

All jobs: 3 retry attempts, exponential backoff (1s → 4s → 16s).

## Key Architecture Decisions

- **BullMQ over node-cron** — Redis-backed, retries, rate limiting, horizontal scaling
- **Hono over Express** — 3x faster, smaller bundle, native TypeScript
- **Neon DB over Railway Postgres** — Railway Postgres kept crashing; Neon is serverless, auto-scales, free tier generous
- **Polymarket-first** — 80% of features depend on Polymarket's on-chain transparency
- **PostgreSQL + Redis dual layer** — PG for durable data, Redis for real-time + job queue
- **npm workspaces monorepo** — Shared TypeScript types via @markypie/shared
- **Multi-tier whale detection** — $5K/10K/50K/100K thresholds (research-backed)
- **Jaccard similarity for market matching** — Token-based fuzzy with synonym normalization, threshold 0.55
- **ethers.js v6 JsonRpcProvider** — HTTP polling for Polygon RPC (more reliable than WS)
- **pg Pool max 5** — Neon DB free tier connection limit

## Known Issues / TODOs

- WebSocket subscription protocol needs research for proper real-time price streaming
- Kalshi categories all showing "other" — normalizeCategory needs tuning
- Arbitrage detection finds 0 opportunities — matched markets have different question scopes
- Frontend dashboard components are skeleton (need real data wired up)
- TradingView Lightweight Charts not yet integrated in market detail page
- Copy trading UI not yet built (Phase 4)
- Alerts system not yet built (Phase 4)
- Chain indexer disabled for MVP (enabled via env flag)

## Polymarket APIs Used

| API | Base URL | Auth | Purpose |
|-----|----------|------|---------|
| Gamma API | https://gamma-api.polymarket.com | None | Market discovery, metadata, profiles |
| Data API | https://data-api.polymarket.com | None | Trades, positions, leaderboard |
| CLOB API | https://clob.polymarket.com | API key for writes | Order book, prices, copy trading |
| CLOB WebSocket | wss://ws-subscriptions-clob.polymarket.com/ws/market | None | Real-time prices, live trades |

## Kalshi APIs Used

| API | Base URL | Auth | Purpose |
|-----|----------|------|---------|
| REST API | https://api.elections.kalshi.com/trade-api/v2 | None for reads | Market data, events |
| WebSocket | wss://api.elections.kalshi.com/trade-api/ws/v2 | RSA key | Real-time feed (Phase 4) |

## On-Chain Contracts (Polygon)

| Contract | Address | Purpose |
|----------|---------|---------|
| CTF Exchange | 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E | Binary market trading, OrderFilled events |
| NegRisk CTF Exchange | 0xC5d563A36AE78145C45a50134d48A1215220f80a | Multi-outcome trading, same events |
| Conditional Tokens | 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045 | ERC-1155 outcome tokens |
| Proxy Wallet Factory | 0xaB45c5A4B0c941a2F231C04C3f49182e1A254052 | Creates user proxy wallets |

## Key Constants

- **Whale thresholds**: $5K (notable), $10K (whale), $50K (mega), $100K (ultra)
- **Smart Score weights**: 40% win rate, 30% ROI, 20% consistency, 10% volume
- **Smart Money threshold**: Score >= 60
- **Safety Score baseline**: 50 points
- **Arbitrage detection**: spread > 2%, both sides volume > $1K
- **Market matching Jaccard**: 0.55 threshold
- **Redis TTLs**: Consensus 5 min, API cache 60s, Wallet enriched 24h
- **Polygon RPC**: polygon-bor-rpc.publicnode.com (publicnode — free, no key needed)
