// =============================================================
// MarkyPie Constants
// Shared across frontend and backend
// =============================================================

/** Supported prediction market platforms */
export const PLATFORMS = {
  POLYMARKET: 'polymarket' as const,
  KALSHI: 'kalshi' as const,
};

/** Market categories (used for filtering and expertise tracking) */
export const CATEGORIES = [
  'politics',
  'economics',
  'crypto',
  'sports',
  'entertainment',
  'science',
  'technology',
  'world',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Trade size tiers for Polymarket (based on real platform data).
 *
 * Research sources:
 * - PolyTrack whale tracker: $10K default threshold
 * - Polywhaler: $10K threshold
 * - Polymaster (open-source): $25K default
 * - Polymarket Bros: $4K minimum
 * - On-chain analysis: ~60-70% of trades are under $100,
 *   only ~1-3% are $5K-$10K, <0.5% are $25K+
 *
 * These are defaults — users can customize via alert configs.
 */
export const TRADE_SIZE_TIERS = {
  /** Top ~3-5% of trades. Worth noting but not alarming */
  NOTABLE: 5_000,
  /** Industry standard whale threshold (PolyTrack, Polywhaler) */
  WHALE: 10_000,
  /** Very rare, extremely high-signal trades */
  MEGA_WHALE: 50_000,
  /** Handful per day at most. Institutional-level */
  ULTRA_WHALE: 100_000,
} as const;

/**
 * Account-level classification by total volume traded.
 * Based on PolyTrack's real trader tier system.
 *
 * Source: https://www.polytrackhq.app/blog/polymarket-whale-tracker
 * - Whale accounts (>$50K volume) = only 1.74% of all Polymarket accounts
 */
export const ACCOUNT_TIERS = {
  RETAIL: { maxVolume: 10_000, label: 'Retail' },
  ACTIVE_TRADER: { maxVolume: 100_000, label: 'Active Trader' },
  SIGNIFICANT: { maxVolume: 500_000, label: 'Significant Trader' },
  WHALE: { maxVolume: 2_000_000, label: 'Whale' },
  MAJOR_WHALE: { maxVolume: Infinity, label: 'Major Whale' },
} as const;

/** Default whale trade threshold (configurable per user via alert settings) */
export const DEFAULT_WHALE_THRESHOLD = TRADE_SIZE_TIERS.WHALE;

/** Smart Score boundaries for tagging */
export const SMART_SCORE_TAGS = {
  ELITE_TRADER: { min: 80, max: 100, label: 'Elite Trader' },
  SMART_MONEY: { min: 60, max: 79, label: 'Smart Money' },
  SKILLED_TRADER: { min: 40, max: 59, label: 'Skilled Trader' },
  ACTIVE_TRADER: { min: 0, max: 39, label: 'Active Trader' },
  LOSING_TRADER: { min: -100, max: -1, label: 'Losing Trader' },
} as const;

/** Safety Score rating boundaries */
export const SAFETY_RATINGS = {
  VERY_SAFE: { min: 90, max: 100, label: 'Very Safe' },
  MODERATE: { min: 60, max: 89, label: 'Moderate' },
  RISKY: { min: 40, max: 59, label: 'Risky' },
  DANGEROUS: { min: 0, max: 39, label: 'Dangerous' },
} as const;

/** Polymarket on-chain contract addresses (Polygon) */
export const POLYMARKET_CONTRACTS = {
  /** Main exchange for binary markets — emits OrderFilled, OrdersMatched */
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  /** Exchange for multi-outcome markets (NegRisk) */
  NEGRISK_CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  /** ERC-1155 conditional token contract — emits PositionsSplit, PositionsMerge */
  CONDITIONAL_TOKENS: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  /** Factory that creates proxy wallets for users */
  PROXY_WALLET_FACTORY: '0xaB45c5A4B0c941a2F231C04C3f49182e1A254052',
} as const;

/** Polymarket API base URLs */
export const POLYMARKET_APIS = {
  GAMMA: 'https://gamma-api.polymarket.com',
  DATA: 'https://data-api.polymarket.com',
  CLOB: 'https://clob.polymarket.com',
  CLOB_WS: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  LIVE_DATA_WS: 'wss://ws-live-data.polymarket.com',
} as const;

/** Kalshi API base URLs */
export const KALSHI_APIS = {
  REST: 'https://api.elections.kalshi.com/trade-api/v2',
  WS: 'wss://api.elections.kalshi.com/trade-api/ws/v2',
  DEMO_REST: 'https://demo-api.kalshi.co/trade-api/v2',
} as const;

/** Arbitrage detection: minimum spread percentage to flag */
export const MIN_ARBITRAGE_SPREAD_PCT = 2;

/** Number of top wallets to seed from leaderboard */
export const LEADERBOARD_SEED_COUNT = 500;

// =============================================================
// Phase 2: Intelligence Layer Configuration
// =============================================================

/** Smart Score calculation weights and thresholds */
export const SMART_SCORE_CONFIG = {
  /** Win Rate component weight (40%) */
  WIN_RATE_WEIGHT: 0.4,
  /** ROI component weight (30%) */
  ROI_WEIGHT: 0.3,
  /** Consistency/Sharpe component weight (20%) */
  CONSISTENCY_WEIGHT: 0.2,
  /** Volume component weight (10%) */
  VOLUME_WEIGHT: 0.1,
  /** Minimum resolved markets to compute real win rate (else use PnL estimate) */
  MIN_RESOLVED_MARKETS: 3,
  /** Minimum trades to compute Sharpe ratio (else default to neutral) */
  MIN_TRADES_FOR_SHARPE: 5,
  /** Smart Score threshold for "smart money" classification */
  SMART_MONEY_THRESHOLD: 60,
} as const;

/** Market Safety Score thresholds for each component */
export const SAFETY_SCORE_CONFIG = {
  HIGH_VOLUME: 1_000_000,
  MEDIUM_VOLUME: 100_000,
  LOW_VOLUME: 10_000,
  MICRO_VOLUME: 1_000,
  HIGH_LIQUIDITY: 500_000,
  MEDIUM_LIQUIDITY: 100_000,
  LOW_LIQUIDITY: 10_000,
  MICRO_LIQUIDITY: 1_000,
} as const;

/** Wallet enrichment configuration */
export const ENRICHMENT_CONFIG = {
  /** Number of wallets to enrich per run */
  BATCH_SIZE: 20,
  /** Max trades to fetch per wallet from API (50 for fast initial, deepens over time) */
  MAX_TRADES_PER_WALLET: 50,
  /** Delay between API calls (ms) to avoid rate limiting */
  RATE_LIMIT_DELAY_MS: 150,
  /** How long before a wallet can be re-enriched (seconds) */
  ENRICHMENT_TTL_SECONDS: 86400, // 24 hours
} as const;

/** Redis key patterns */
export const REDIS_KEYS = {
  /** market:{platform}:{id}:price → JSON { yes, no, volume } */
  marketPrice: (platform: string, id: string) => `market:${platform}:${id}:price`,
  /** feed:whale_trades → List of recent whale trades */
  whaleFeed: 'feed:whale_trades',
  /** wallet:{address}:last_trade → JSON of last trade */
  walletLastTrade: (address: string) => `wallet:${address}:last_trade`,
  /** leaderboard:pnl:{period} → Sorted Set */
  leaderboard: (period: string) => `leaderboard:pnl:${period}`,
  /** arb:active → Set of active arbitrage IDs */
  activeArbitrage: 'arb:active',
  /** ratelimit:{ip} → Counter */
  rateLimit: (ip: string) => `ratelimit:${ip}`,
  /** cache:market:{id} → JSON market details (60s TTL) */
  marketCache: (id: string) => `cache:market:${id}`,
  /** cache:wallet:{addr}:positions → JSON positions (30s TTL) */
  walletPositionsCache: (addr: string) => `cache:wallet:${addr}:positions`,
  /** consensus:market:{id} → JSON SmartMoneyConsensus (5 min TTL) */
  smartMoneyConsensus: (marketId: string) => `consensus:market:${marketId}`,
  /** enriched:wallet:{address} → "1" with 24h TTL (tracks enrichment status) */
  walletEnriched: (address: string) => `enriched:wallet:${address}`,
} as const;
