# MarkyPie — Project Context

## What This Project Is

**MarkyPie** is a GMGN.ai-style platform for prediction markets (Polymarket + Kalshi).

GMGN.ai tracks smart money, whale wallets, and provides copy trading for memecoins on Solana/ETH. MarkyPie applies the same concept to prediction markets — tracking whale wallets on Polymarket, detecting large trades on Kalshi, providing copy trading, Market Safety Scores, arbitrage detection, and real-time alerts.

## Key Documents

- `MARKYPIE_DOC.md` — Clean, structured product document (Problem Statement, Solution, Revenue Model, MVP Plan with all frontend features). This is the "Google Doc" / presentation-ready version.
- `PLAN.md` — Deep technical plan with full architecture diagrams, complete PostgreSQL schema, Redis key structure, all API endpoints documented, ASCII wireframes for every page, project folder structure, and implementation phases.
- `GMGN_TO_PREDICTION_MARKETS_MAPPING.md` — Detailed research mapping all 10 GMGN features to prediction market equivalents with 80+ source links.

## Research Completed

The following research has been done thoroughly in prior conversations:

1. **GMGN.ai** — Full understanding: smart money tracking, sniper bots, copy trading, token security, anti-MEV, fee structure, architecture, user flow, PumpFun/Moonshot integration
2. **Polymarket** — Full understanding: Gnosis CTF (ERC-1155), hybrid CLOB (off-chain matching + on-chain settlement), UMA Optimistic Oracle, NegRisk adapter, all APIs (Gamma, Data, CLOB, WebSockets), on-chain contracts on Polygon, price discovery (YES + NO = $1)
3. **Kalshi** — Full understanding: CFTC-regulated, centralized (NOT crypto — pure USD internally), FDIC insured, variable fees (1-5.6%), RSA key auth, anonymous trades (no wallet transparency), REST + WebSocket APIs
4. **Feature Translation** — Honest analysis of which GMGN features apply:
   - Works perfectly: Smart Money Tracking, Position Analysis, Alerts, Leaderboard, Cross-Platform
   - Works but different: Copy Trading (Polymarket only), New Market Scanner (lower volume), Execution Quality
   - Does NOT translate: Sniper Bot, Anti-MEV, Bundled Wallet Detection
   - NEW opportunities: Cross-platform arbitrage, Market Safety Score, Smart vs Retail divergence
5. **Competitive Landscape** — 170+ fragmented tools exist (PolyTrack, Hashdive, Polysights, Unusual Predictions, Oddpool, 0xInsider) but none combine all features into one product

## Tech Stack

- Node.js 22 + TypeScript, Next.js 15 + React 19, Tailwind CSS 4
- TradingView Lightweight Charts v5
- PostgreSQL 16 + Redis 7 (ioredis), BullMQ
- ws (WebSocket server), react-use-websocket (client)
- Polygon RPC + ethers.js (on-chain indexing)
- grammy (Telegram bot), @polymarket/clob-client (copy trading)
- JWT auth (anonymous sessions for MVP)

## Implementation Timeline

5 phases, 10 weeks:
1. Foundation + Data Pipeline (Week 1-2) ← CURRENTLY BUILDING
2. Intelligence Layer — Smart Score + Market Safety Score (Week 3-4)
3. Frontend — Dashboard + Market Detail + Wallet Profile (Week 5-6)
4. Alerts + Copy Trading (Week 7-8)
5. Polish + Launch (Week 9-10)

## Revenue Model

Free → Pro $29/mo → Premium $79/mo → API $199/mo + referral fees

## Important Notes

- Kalshi has NO wallet/user transparency — smart money tracking only works on Polymarket. Kalshi is useful for cross-platform aggregation and arbitrage only.
- Copy trading only works on Polymarket (on-chain execution via CLOB API). Kalshi is centralized and anonymous.
- The user refers to the project as "MarkyPie" (previously "Magpie" in early messages).
- The user's communication style is casual ("bro").
- User wants detailed explanations for every file, API, SDK, and decision during implementation.
- User explicitly requested BullMQ over node-cron for production-grade job scheduling (scalable, Redis-backed, retries, rate limiting).
- User setup: Windows 11 Home, npm (not pnpm/yarn).
- Docker Desktop CANNOT run — Windows 11 Home lacks Hyper-V, user refuses WSL2 (caused issues on previous PC).
- **Native installs instead of Docker:** PostgreSQL 18 installed locally + Memurai (Redis for Windows) installed locally.
- PostgreSQL: user `postgres`, password `markypie`, database `markypie` created, port 5432. pgAdmin 4 bundled with install.
- Redis (Memurai): running on default port 6379, confirmed with PING/PONG.
- `.env` updated: `DATABASE_URL=postgresql://postgres:markypie@localhost:5432/markypie`
- User requirement: "first have my setup, then do steps, we need to test each step then we move forward"

## Phase 1 Implementation Progress

### STATUS: ALL 12 STEPS CODED + TYPESCRIPT COMPILES CLEAN

`npm install` completed successfully (211 packages, 0 vulnerabilities).
TypeScript compilation passes with zero errors (`tsc --noEmit`).

### COMPLETED CODE (Steps 1-12):

**Step 1: Project Scaffold**
- npm workspaces monorepo: `apps/web`, `apps/server`, `packages/shared`
- Root `package.json` with workspace scripts (`dev:server`, `dev:web`, `db:up`, `db:down`)
- Root `tsconfig.json` (ES2022 target, strict mode)
- `.gitignore`, `.env.example`, `.env`

**Step 2: Docker Compose + Database Schema**
- `docker-compose.yml` — PostgreSQL 16 (port 5432) + Redis 7 (port 6379)
- Auto-runs migration SQL on first start via `docker-entrypoint-initdb.d`
- Full database schema in `apps/server/src/db/migrations/001_initial_schema.sql`:
  - Core tables: markets, wallets, wallet_scores, trades, positions
  - Feature tables: alert_configs, copy_trade_configs, copy_trade_executions, market_safety_scores, arbitrage_opportunities, sessions
  - All indexes for performance
- User connects pgAdmin to localhost:5432 to browse data visually

**Step 3: Shared Types Package**
- `packages/shared/src/types.ts` — TypeScript types for all entities + raw API response types
- `packages/shared/src/constants.ts` — Platform names, categories, Smart Score tags, Safety ratings, Polymarket contracts, API URLs, Redis keys, research-backed whale thresholds
- `packages/shared/src/index.ts` — Barrel export

**Step 4: Server Foundation**
- `apps/server/package.json` — Dependencies: pg, ioredis, bullmq, ethers, ws, dotenv, pino, tsx
- `apps/server/src/config/env.ts` — Environment variable loader with validation
- `apps/server/src/utils/logger.ts` — pino logger with pino-pretty for dev
- `apps/server/src/db/postgres.ts` — PostgreSQL connection pool (max 20), auto-run migrations from migrations dir
- `apps/server/src/db/redis.ts` — Redis connection (ioredis, BullMQ-compatible)

**Step 5: Polymarket Market Sync (Gamma API)**
- `apps/server/src/ingestion/polymarket-sync.ts`
- Fetches events from `GET https://gamma-api.polymarket.com/events`
- Upserts markets into PostgreSQL, normalizes categories
- No auth required

**Step 6: Polymarket Trade Ingestion (Data API)**
- `apps/server/src/ingestion/polymarket-trades.ts`
- Fetches trades from `GET https://data-api.polymarket.com/trades`
- Multi-tier whale classification (Notable $5K, Whale $10K, Mega $50K, Ultra $100K)
- Pushes whale trades to Redis feed `feed:whale_trades`

**Step 7: Polymarket Wallet Discovery (Leaderboard API)**
- `apps/server/src/ingestion/polymarket-wallets.ts`
- Fetches top 500 from leaderboard, fetches profiles from Gamma API
- Upserts with pseudonym, profile image, Twitter handle

**Step 8: Polymarket WebSocket (Real-time Prices)**
- `apps/server/src/ingestion/polymarket-ws.ts`
- Connects to `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- Subscribes to price_change and last_trade_price channels
- Auto-reconnection with exponential backoff

**Step 9: On-Chain Indexer (Polygon)**
- `apps/server/src/ingestion/chain-indexer.ts`
- Uses ethers.js v6 to connect to Polygon RPC
- Listens to OrderFilled events on CTF Exchange (`0x4bFb41...`) and NegRisk CTF Exchange (`0xC5d563...`)
- Decodes events: maker, taker, amounts, fees
- Converts from USDC decimals (6) to USD, detects whale trades
- Pushes to Redis whale feed with source='on-chain'
- Auto-reconnection with exponential backoff (max 20 attempts)

**Step 10: Kalshi Market Sync**
- `apps/server/src/ingestion/kalshi-sync.ts`
- Fetches from `GET https://api.elections.kalshi.com/trade-api/v2/markets?status=open`
- Cursor-based pagination, converts Kalshi cents (0-100) to decimal (0-1)
- Normalizes categories to unified schema
- Upserts into same markets table with platform='kalshi'

**Step 11: Cross-Platform Market Matching**
- `apps/server/src/ingestion/market-matcher.ts`
- Fuzzy matches Polymarket and Kalshi markets using Jaccard similarity on normalized title tokens
- Stop word removal, synonym normalization (fed ↔ federal reserve, etc.)
- Threshold: 0.6 (60% token overlap)
- Links matched markets via matched_market_id
- Detects arbitrage opportunities (spread > 2%)
- Stores in arbitrage_opportunities table + Redis set

**Step 12: Server Entry Point + BullMQ Orchestration**
- `apps/server/src/index.ts`
- BullMQ queues and workers for all scheduled jobs:
  - market-sync: every 5 min (Polymarket + Kalshi in parallel)
  - trade-sync: every 1 min (Polymarket trades)
  - wallet-sync: every 24 hours (leaderboard wallets)
  - market-match: every 10 min (cross-platform matching)
- All jobs have retry logic (3 attempts, exponential backoff)
- Starts WebSocket + chain indexer as persistent connections
- Runs initial sync on startup (doesn't wait for schedule)
- Graceful shutdown on SIGINT/SIGTERM (closes workers, connections)

### SETUP COMPLETED:

- PostgreSQL 18 installed natively on Windows (user `postgres`, password `markypie`)
- Memurai (Redis for Windows) installed natively, running on port 6379
- Database `markypie` created on PostgreSQL
- `.env` updated with correct connection string (`postgresql://postgres:markypie@localhost:5432/markypie`)
- Both connections verified (PostgreSQL: `SELECT 1` works, Redis: `PING` → `PONG`)

### PHASE 1 TESTING — ALL VERIFIED:

**Database Migrations:** All 11 tables + 13 indexes created successfully. Migration uses IF NOT EXISTS (idempotent).

**Server Startup:** `npm run dev --workspace=apps/server` starts cleanly. BullMQ workers, WebSocket, chain indexer all initialize.

**Polymarket Market Sync:** 46,949 markets synced from Gamma API.
- Fixed: API returns camelCase (`conditionId`, `outcomePrices` JSON string), not snake_case.

**Kalshi Market Sync:** 178,613 markets synced via cursor-based pagination.
- Total markets: 225,562 across both platforms.

**Trade Ingestion:** 2,700+ trades ingested and growing.
- Fixed: API returns `proxyWallet` (not `trader_address`), `conditionId` (not `market`), `transactionHash` (not `transaction_hash`), `outcomeIndex` for YES/NO mapping.
- Fixed: timestamp filter — only advance `lastSyncTimestamp` when new trades found, use newest trade timestamp (not Date.now()).
- Fixed: tx_hash dedup to handle Cloudflare CDN 5-min cache returning same trades.
- Added: `idx_trades_tx_hash` index for dedup performance.

**Whale Detection:** 5 whale trades detected including a $169K ultra whale.
- Example: $169,803 BUY NO on "Games Total: O/U 2.5" (tier: ultra)
- Example: $15,114 SELL NO on "US strikes Iran by March 31, 2026?" (tier: whale)
- All whale trades pushed to Redis `feed:whale_trades` with correct tiers.

**Wallet Discovery:** 651 wallets discovered (exceeds 500 target).
- Leaderboard API at `/v1/leaderboard` returns `proxyWallet`, `userName`, `xUsername`.
- Profile API enriches with pseudonyms from Gamma API.
- Real usernames: DrPufferfish, elkmonkey, c4c4, PeterSagan, etc.

**Cross-Platform Matching:** 54 markets matched (27 pairs).
- Jaccard similarity matching works. Examples: Rachida Dati Paris election, Ukraine World Cup, CDU Rhineland-Palatinate.
- Some false matches (slightly different questions) — expected with fuzzy matching.

**Chain Indexer:** Connected to Polygon via PublicNode RPC (`polygon-bor-rpc.publicnode.com`).
- Previous RPCs dead: polygon-rpc.com (401), blast API (403 shutdown), ankr (requires key).
- Listening to OrderFilled events on both CTF Exchange and NegRisk CTF Exchange.

**WebSocket:** Connected to Polymarket CLOB WebSocket.
- Fixed: subscription format changed from individual `assets_id` to batch `markets` array.
- Fixed: non-JSON message handling (gracefully skips "INVALID OPERATION", "OK" responses).
- TODO: Research exact CLOB WS subscription protocol for proper real-time price updates.

### API Response Field Mappings (Critical Reference):

**Polymarket Data API `/trades` response (camelCase):**
```
proxyWallet, side, asset, conditionId, size (number), price (number),
timestamp, title, outcome, outcomeIndex, transactionHash, name, pseudonym
```

**Polymarket Data API `/v1/leaderboard` response (camelCase):**
```
rank (string), proxyWallet, userName, xUsername, verifiedBadge, vol, pnl, profileImage
```

**Polymarket Gamma API `/events` response (camelCase):**
```
events[].markets[]: conditionId, question, outcomePrices (JSON string),
outcomes (JSON string), volumeNum, liquidityNum, endDate, active, closed
```

### KNOWN ISSUES / TODO:

- WebSocket subscription protocol needs research for proper real-time price streaming
- Kalshi categories all showing "other" — `normalizeCategory` needs tuning for actual Kalshi category strings
- Arbitrage detection finds 0 opportunities currently — matched markets have different question scopes (e.g., "win 1st round by 5-10%" vs "win election")
- Next.js frontend is skeleton only (placeholder page)

### NEXT STEP: Phase 2 — Intelligence Layer (Smart Score + Market Safety Score)

## Polymarket APIs Used

| API | Base URL | Auth | What We Use It For |
|-----|----------|------|--------------------|
| Gamma API | https://gamma-api.polymarket.com | None | Market discovery, metadata, events, public profiles |
| Data API | https://data-api.polymarket.com | None | Trades, positions, leaderboard, wallet activity |
| CLOB API | https://clob.polymarket.com | API key for writes | Order book, prices (future: copy trade execution) |
| CLOB WebSocket | wss://ws-subscriptions-clob.polymarket.com/ws/market | None | Real-time price updates, live trade stream |

## Kalshi APIs Used

| API | Base URL | Auth | What We Use It For |
|-----|----------|------|--------------------|
| REST API | https://api.elections.kalshi.com/trade-api/v2 | None for reads | Market data, events, anonymous trade history |
| WebSocket | wss://api.elections.kalshi.com/trade-api/ws/v2 | RSA key | Real-time ticker, trade feed (future) |

## On-Chain Contracts (Polygon)

| Contract | Address | What It Does |
|----------|---------|--------------|
| CTF Exchange | 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E | Binary market trading — emits OrderFilled events |
| NegRisk CTF Exchange | 0xC5d563A36AE78145C45a50134d48A1215220f80a | Multi-outcome market trading — same OrderFilled events |
| Conditional Tokens | 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045 | ERC-1155 token contract for outcome tokens |
| Proxy Wallet Factory | 0xaB45c5A4B0c941a2F231C04C3f49182e1A254052 | Creates proxy wallets for users |

## Key Architecture Decisions

- **BullMQ over node-cron** — Redis-backed job queue for reliability, retries, rate limiting, horizontal scaling. node-cron is process-bound and loses jobs on crash.
- **Polymarket-first** — 80% of features depend on Polymarket's on-chain transparency. Kalshi is secondary (market data + arbitrage only).
- **PostgreSQL + Redis dual layer** — PostgreSQL for durable data (trades, wallets, scores), Redis for real-time data (live prices, whale feed, leaderboard, job queue).
- **npm workspaces monorepo** — Frontend and backend share TypeScript types via @markypie/shared package.
- **Docker Compose for databases** — Clean, portable, one-command setup. User connects pgAdmin to localhost:5432 for data visibility.
- **Multi-tier whale detection** — Research-backed thresholds from PolyTrack, Polywhaler, on-chain analysis. Configurable per-user via alert_configs.
- **Jaccard similarity for market matching** — Token-based fuzzy matching with synonym normalization. Better than Levenshtein for differently-phrased same events.
- **ethers.js v6 JsonRpcProvider** — HTTP polling (not WebSocket) for Polygon RPC. More reliable, auto-polls every ~4 seconds.
