// =============================================================
// MarkyPie Core Types
// These types map directly to our PostgreSQL database tables.
// Both the server and frontend import from here so they always
// agree on data shapes.
// =============================================================

/** Which prediction market platform a record belongs to */
export type Platform = 'polymarket' | 'kalshi';

/** Market status lifecycle */
export type MarketStatus = 'active' | 'closed' | 'resolved';

/** Trade direction */
export type TradeSide = 'BUY' | 'SELL';

/** Market outcome */
export type Outcome = 'YES' | 'NO';

/** Smart Score tag based on score range */
export type SmartTag =
  | 'elite_trader'    // 80-100
  | 'smart_money'     // 60-79
  | 'skilled_trader'  // 40-59
  | 'active_trader'   // 0-39
  | 'losing_trader';  // < 0

/** Safety Score rating based on score range */
export type SafetyRating =
  | 'very_safe'   // 90-100
  | 'moderate'    // 60-89
  | 'risky'       // 40-59
  | 'dangerous';  // 0-39

// =============================================================
// Database entity types (match PostgreSQL tables 1:1)
// =============================================================

/** Unified prediction market from either platform */
export interface Market {
  id: string;                          // UUID
  platform: Platform;
  platform_id: string;                 // condition_id (Polymarket) or ticker (Kalshi)
  title: string;
  description: string | null;
  category: string | null;             // politics, economics, sports, crypto, etc.
  status: MarketStatus;
  yes_price: number | null;            // 0.00 to 1.00
  no_price: number | null;
  volume: number;                      // total volume traded (USD)
  liquidity: number;
  outcome: Outcome | null;             // null if unresolved
  resolution_source: string | null;
  end_date: string | null;             // ISO timestamp
  safety_score: number | null;         // 0-100
  safety_details: SafetyDetails | null;
  token_ids: string[] | null;           // ERC-1155 token IDs (Polymarket only, for WebSocket)
  matched_market_id: string | null;    // UUID of equivalent market on other platform
  created_at: string;
  updated_at: string;
}

/** Tracked Polymarket wallet */
export interface Wallet {
  id: string;
  address: string;                     // Polygon wallet address
  proxy_address: string | null;        // Polymarket proxy wallet if different
  pseudonym: string | null;            // Polymarket display name
  profile_image: string | null;
  x_username: string | null;           // Twitter/X handle
  is_verified: boolean;
  tags: string[];                      // ['whale', 'smart_money', 'elite_trader', etc.]
  total_volume: number;                // total traded volume from leaderboard
  total_pnl: number;                   // profit/loss from leaderboard
  leaderboard_rank: number | null;     // rank on Polymarket leaderboard
  first_seen: string;
  last_active: string | null;
  created_at: string;
}

/** Smart Score for a wallet over a time period */
export interface WalletScore {
  id: string;
  wallet_id: string;
  period: '7d' | '30d' | '90d' | 'all';
  total_pnl: number;
  total_volume: number;
  win_rate: number | null;             // 0.0 to 1.0
  total_markets: number;
  winning_markets: number;
  avg_position_size: number | null;
  roi: number | null;                  // percentage
  sharpe_ratio: number | null;
  smart_score: number | null;          // -100 to 100
  category_expertise: Record<string, number> | null;  // { politics: 0.78, sports: 0.62 }
  calculated_at: string;
}

/** Individual trade on a prediction market */
export interface Trade {
  id: string;
  platform: Platform;
  market_id: string | null;
  wallet_id: string | null;
  wallet_address: string | null;
  side: TradeSide;
  outcome: Outcome;
  price: number;                       // 0.00 to 1.00
  size: number;                        // USD amount
  token_amount: number | null;         // number of shares
  tx_hash: string | null;
  is_whale: boolean;                   // true if size > WHALE_THRESHOLD
  platform_timestamp: string;
  created_at: string;
}

/** Current position of a wallet in a market */
export interface Position {
  id: string;
  wallet_id: string;
  market_id: string;
  outcome: Outcome;
  size: number;                        // number of shares
  avg_price: number;
  initial_value: number;
  current_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  realized_pnl: number;
  updated_at: string;
}

/** Market Safety Score breakdown */
export interface SafetyDetails {
  liquidity_score: number;             // 0-25
  resolution_score: number;            // 0-25
  manipulation_score: number;          // 0-25
  structural_score: number;            // 0-25
}

/** Smart Score calculation breakdown (for transparency/debugging) */
export interface SmartScoreBreakdown {
  win_rate_score: number;        // 0-100 component score
  roi_score: number;             // 0-100 component score
  consistency_score: number;     // 0-100 component score
  volume_score: number;          // 0-100 component score
  win_rate_raw: number | null;   // actual win rate 0-1
  roi_raw: number | null;        // actual ROI percentage
  sharpe_raw: number | null;     // actual Sharpe ratio
  resolved_markets: number;      // how many resolved markets we had data for
  total_trades: number;          // total trades used in calculation
  data_quality: 'high' | 'medium' | 'low';  // based on data availability
}

/** Smart Money Consensus for a market */
export interface SmartMoneyConsensus {
  market_id: string;
  yes_pct: number;               // 0-1: percentage of smart money on YES
  no_pct: number;                // 0-1: percentage of smart money on NO
  weighted_yes_pct: number;      // 0-1: weighted by smart score
  weighted_no_pct: number;       // 0-1: weighted by smart score
  smart_wallet_count: number;    // how many smart wallets have positions
  total_smart_value: number;     // total USD value of smart money positions
  updated_at: number;            // timestamp
}

/** Cross-platform arbitrage opportunity */
export interface ArbitrageOpportunity {
  id: string;
  market_a_id: string;
  market_b_id: string;
  price_a: number;
  price_b: number;
  spread: number;                      // absolute price difference
  spread_pct: number;                  // percentage spread
  detected_at: string;
  expired_at: string | null;           // null if still active
}

// =============================================================
// API response types (what Polymarket/Kalshi APIs return)
// =============================================================

/** Raw market data from Polymarket Gamma API (camelCase as returned by API) */
export interface PolymarketGammaMarket {
  conditionId: string;               // 0x... hash — unique market identifier
  question: string;                  // "Will the Fed cut rates?"
  description: string;
  outcomes: string;                  // JSON string: '["Yes", "No"]'
  outcomePrices: string;             // JSON string: '["0.35", "0.65"]'
  volume: string;                    // string number "292341.742231"
  volumeNum: number;                 // numeric version of volume
  liquidity?: string;                // string number
  liquidityNum?: number;             // numeric version of liquidity
  active: boolean;
  closed: boolean;
  endDate?: string;                  // ISO timestamp "2026-07-01T04:00:00Z"
  endDateIso?: string;               // simplified "2026-07-01"
  slug: string;
  category?: string;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  clobTokenIds?: string;               // JSON string: '["token_yes_id", "token_no_id"]'
}

/** Raw event data from Polymarket Gamma API */
export interface PolymarketGammaEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  tags?: Array<{ label: string; slug: string }>;
  markets: PolymarketGammaMarket[];
}

/** Raw trade from Polymarket Data API (camelCase as returned by API) */
export interface PolymarketTrade {
  proxyWallet: string;            // trader's proxy wallet address on Polygon
  side: 'BUY' | 'SELL';
  asset: string;                  // ERC-1155 token ID (big number as string)
  conditionId: string;            // market condition hash (0x...)
  size: number;                   // trade size in USD (number, not string!)
  price: number;                  // price paid 0-1 (number, not string!)
  timestamp: number;              // Unix seconds
  title: string;                  // market title
  slug: string;                   // market slug
  icon?: string;                  // market icon URL
  eventSlug: string;              // event slug
  outcome: string;                // "Yes", "No", "Up", "Down", team names, etc.
  outcomeIndex: number;           // 0 = first outcome, 1 = second
  name: string;                   // trader username
  pseudonym: string;              // trader display name
  bio?: string;
  profileImage?: string;
  profileImageOptimized?: string;
  transactionHash: string;        // Polygon transaction hash
}

/** Raw leaderboard entry from Polymarket Data API (camelCase) */
export interface PolymarketLeaderboardEntry {
  rank: string;                   // rank as string (not number!)
  proxyWallet: string;            // wallet address
  userName: string;               // display name
  xUsername: string;              // Twitter/X handle
  verifiedBadge: boolean;
  vol: number;                    // total volume traded
  pnl: number;                   // profit/loss
  profileImage: string;           // profile image URL
}

/** Raw market data from Kalshi API */
export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  category: string;
  status: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  open_interest: number;
  close_time: string;
}

/** Raw event data from Kalshi API */
export interface KalshiEvent {
  event_ticker: string;
  title: string;
  category: string;
  markets: KalshiMarket[];
}
