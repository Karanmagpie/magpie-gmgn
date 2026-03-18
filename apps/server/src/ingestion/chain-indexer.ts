// =============================================================
// On-Chain Indexer (Polygon Blockchain)
// =============================================================
//
// WHAT: Listens to Polymarket's smart contracts on the Polygon
//       blockchain for real-time trade events.
//
// WHY:  The blockchain is the ULTIMATE source of truth for trades.
//       While we also ingest trades via the Data API (polymarket-trades.ts)
//       and WebSocket (polymarket-ws.ts), the on-chain indexer gives us:
//       1. GUARANTEED completeness — blockchain never misses a trade
//       2. INSTANT whale detection — events fire in ~2 seconds
//       3. RAW data access — maker/taker addresses, exact amounts
//       4. CROSS-VERIFICATION — verify API data against chain data
//
// HOW IT WORKS:
//       1. Connect to a Polygon RPC node via ethers.js v6
//       2. Create Contract instances for the CTF Exchange and
//          NegRisk CTF Exchange (two separate contracts)
//       3. Subscribe to "OrderFilled" events on both contracts
//       4. When an event fires:
//          a. Decode the event data (maker, taker, amounts, token IDs)
//          b. Calculate the USD value of the trade
//          c. If value > whale threshold: push to Redis whale feed
//          d. Insert into our trades table
//       5. Handle reconnection if the RPC connection drops
//
// CONTRACTS:
//       CTF Exchange: 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
//         - Handles binary markets (Yes/No only)
//         - Emits OrderFilled for every matched trade
//
//       NegRisk CTF Exchange: 0xC5d563A36AE78145C45a50134d48A1215220f80a
//         - Handles multi-outcome markets (3+ outcomes)
//         - Same OrderFilled event structure
//
// POLYGON:
//       Polygon PoS is an Ethereum Layer 2 with:
//       - ~2 second block times (vs Ethereum's ~12 seconds)
//       - Gas costs of fractions of a cent (vs Ethereum's dollars)
//       - EVM-compatible (same tools, same ABIs)
//       - RPC endpoints: polygon-rpc.com (free), Alchemy, Infura
//
// ETHERS.JS v6:
//       ethers.js is the standard Ethereum interaction library.
//       v6 is the latest major version with breaking changes from v5:
//       - New provider hierarchy (JsonRpcProvider, WebSocketProvider)
//       - BigInt instead of BigNumber
//       - Improved TypeScript support
//       We use ethers.Contract to subscribe to events on the CTF Exchange.
//
// DOCS:
//       - ethers.js: https://docs.ethers.org/v6/
//       - Polygon: https://polygon.technology/
//       - CTF Exchange: https://github.com/Polymarket/ctf-exchange
// =============================================================

import { ethers } from 'ethers';
import { db } from '../db/postgres';
import { redis } from '../db/redis';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';
import { POLYMARKET_CONTRACTS, REDIS_KEYS, TRADE_SIZE_TIERS } from '@markypie/shared';

const log = createLogger('chain-indexer');

// ---- ABI Fragment for OrderFilled Event ----
//
// This is a minimal ABI — we only need the event definition,
// not the full contract ABI. ethers.js uses this to:
// 1. Calculate the event topic hash (keccak256 of the signature)
// 2. Know how to decode the event log data into typed parameters
//
// The "indexed" parameters (orderHash, maker, taker) are stored
// in the log's "topics" array (up to 3 indexed params per event).
// Non-indexed parameters are stored in the "data" field and must
// be ABI-decoded.
//
// uint256 values come as BigInt in ethers v6 (not BigNumber like v5).
// We convert them to numbers for database storage.
const CTF_EXCHANGE_ABI = [
  `event OrderFilled(
    bytes32 indexed orderHash,
    address indexed maker,
    address indexed taker,
    uint256 makerAssetId,
    uint256 takerAssetId,
    uint256 makerAmountFilled,
    uint256 takerAmountFilled,
    uint256 fee
  )`,
];

// ---- State ----
let provider: ethers.JsonRpcProvider | null = null;
let ctfExchange: ethers.Contract | null = null;
let negRiskExchange: ethers.Contract | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

/**
 * Handles an OrderFilled event from the CTF Exchange.
 *
 * When this fires, someone's order just got filled on Polymarket.
 * We extract the trade details and check if it's a whale trade.
 *
 * Trade value calculation:
 * - makerAmountFilled and takerAmountFilled are in wei (10^18)
 * - One side is USDC (6 decimals), the other is conditional tokens
 * - We need to determine which side is paying USDC
 * - The USDC amount = trade value in dollars
 *
 * Conditional token amounts are in 10^6 (USDC decimals) because
 * Polymarket's CTF uses USDC as collateral. So:
 *   makerAmountFilled = 45000000000 (45,000 * 10^6 = $45,000)
 *
 * @param orderHash - Unique hash of the filled order
 * @param maker - Address of the order creator
 * @param taker - Address of the order filler
 * @param makerAssetId - Token ID the maker was trading
 * @param takerAssetId - Token ID the taker was trading
 * @param makerAmountFilled - Amount of maker's tokens filled
 * @param takerAmountFilled - Amount of taker's tokens filled
 * @param fee - Trading fee paid
 * @param exchangeType - Which exchange emitted this ('ctf' or 'negrisk')
 */
async function handleOrderFilled(
  orderHash: string,
  maker: string,
  taker: string,
  makerAssetId: bigint,
  takerAssetId: bigint,
  makerAmountFilled: bigint,
  takerAmountFilled: bigint,
  fee: bigint,
  exchangeType: 'ctf' | 'negrisk',
): Promise<void> {
  try {
    // Convert from USDC decimals (6) to USD
    // Polymarket uses USDC which has 6 decimal places
    // So 45000000000 = 45000 * 10^6 = $45,000
    const makerAmount = Number(makerAmountFilled) / 1e6;
    const takerAmount = Number(takerAmountFilled) / 1e6;
    const feeAmount = Number(fee) / 1e6;

    // The trade size is the larger of the two amounts
    // (one is USDC, the other is conditional tokens — we want the USDC side)
    const tradeSize = Math.max(makerAmount, takerAmount);

    // Multi-tier whale classification (same tiers as polymarket-trades.ts)
    const whaleTier = tradeSize >= TRADE_SIZE_TIERS.ULTRA_WHALE ? 'ultra'
      : tradeSize >= TRADE_SIZE_TIERS.MEGA_WHALE ? 'mega'
      : tradeSize >= TRADE_SIZE_TIERS.WHALE ? 'whale'
      : tradeSize >= TRADE_SIZE_TIERS.NOTABLE ? 'notable'
      : null;

    const isWhale = tradeSize >= env.WHALE_THRESHOLD;

    // Only log notable+ trades to avoid noise
    // (~60-70% of Polymarket trades are under $100)
    if (whaleTier) {
      log.info(
        {
          tier: whaleTier,
          size: `$${tradeSize.toLocaleString()}`,
          maker: `${maker.slice(0, 8)}...`,
          taker: `${taker.slice(0, 8)}...`,
          exchange: exchangeType,
        },
        `On-chain ${whaleTier} trade detected`
      );
    }

    // Look up our internal wallet IDs for maker and taker
    const makerWalletResult = await db.query(
      'SELECT id FROM wallets WHERE address = $1',
      [maker.toLowerCase()]
    );
    const takerWalletResult = await db.query(
      'SELECT id FROM wallets WHERE address = $1',
      [taker.toLowerCase()]
    );

    const makerWalletId = makerWalletResult.rows[0]?.id || null;
    const takerWalletId = takerWalletResult.rows[0]?.id || null;

    // Insert the trade into our database
    // We use the orderHash as a unique identifier to prevent duplicates
    // (the same trade might also come in via the Data API or WebSocket)
    const txHash = orderHash; // Use orderHash as tx reference

    await db.query(
      `INSERT INTO trades (
        platform, wallet_id, wallet_address,
        side, outcome, price, size, tx_hash,
        is_whale, platform_timestamp
      ) VALUES (
        'polymarket', $1, $2,
        'BUY', 'UNKNOWN', $3, $4, $5,
        $6, NOW()
      )
      ON CONFLICT DO NOTHING`,
      [
        makerWalletId || takerWalletId,    // $1: use whichever wallet we track
        maker.toLowerCase(),               // $2: wallet_address (maker)
        takerAmount > 0 ? (makerAmount / takerAmount) : 0, // $3: implied price
        tradeSize,                         // $4: size in USD
        txHash,                            // $5: order hash as tx reference
        isWhale,                           // $6: is_whale flag
      ]
    );

    // Push whale trades to Redis feed for real-time dashboard
    if (isWhale && whaleTier) {
      const feedEntry = JSON.stringify({
        wallet_address: maker.toLowerCase(),
        taker_address: taker.toLowerCase(),
        side: 'BUY',
        outcome: 'YES',
        price: takerAmount > 0 ? (makerAmount / takerAmount) : 0,
        size: tradeSize,
        market_id: null, // We don't have the market ID from on-chain data alone
        timestamp: Date.now(),
        tier: whaleTier,
        source: 'on-chain', // Mark as detected from blockchain (fastest source)
        exchange: exchangeType,
        fee: feeAmount,
      });

      await redis.lpush(REDIS_KEYS.whaleFeed, feedEntry);
      await redis.ltrim(REDIS_KEYS.whaleFeed, 0, 99);
    }
  } catch (err) {
    log.error({ err, orderHash }, 'Failed to process OrderFilled event');
  }
}

/**
 * Sets up event listeners on both CTF Exchange contracts.
 *
 * We listen to both:
 * 1. CTF Exchange — handles standard binary (Yes/No) markets
 * 2. NegRisk CTF Exchange — handles multi-outcome markets
 *    (e.g., "Who wins the election?" with 5+ candidates)
 *
 * Both contracts emit the same OrderFilled event structure,
 * so we can use the same handler for both.
 */
function setupEventListeners(): void {
  if (!ctfExchange || !negRiskExchange) return;

  // Listen to OrderFilled on main CTF Exchange
  ctfExchange.on(
    'OrderFilled',
    (
      orderHash: string,
      maker: string,
      taker: string,
      makerAssetId: bigint,
      takerAssetId: bigint,
      makerAmountFilled: bigint,
      takerAmountFilled: bigint,
      fee: bigint,
    ) => {
      handleOrderFilled(
        orderHash, maker, taker,
        makerAssetId, takerAssetId,
        makerAmountFilled, takerAmountFilled,
        fee, 'ctf',
      );
    }
  );

  // Listen to OrderFilled on NegRisk CTF Exchange
  negRiskExchange.on(
    'OrderFilled',
    (
      orderHash: string,
      maker: string,
      taker: string,
      makerAssetId: bigint,
      takerAssetId: bigint,
      makerAmountFilled: bigint,
      takerAmountFilled: bigint,
      fee: bigint,
    ) => {
      handleOrderFilled(
        orderHash, maker, taker,
        makerAssetId, takerAssetId,
        makerAmountFilled, takerAmountFilled,
        fee, 'negrisk',
      );
    }
  );

  log.info('Event listeners set up on CTF Exchange and NegRisk CTF Exchange');
}

/**
 * Connects to the Polygon blockchain and starts indexing.
 *
 * Connection flow:
 * 1. Create a JsonRpcProvider connected to Polygon RPC
 * 2. Verify connection by fetching the current block number
 * 3. Create Contract instances for both exchanges
 * 4. Set up event listeners
 *
 * We use JsonRpcProvider (HTTP polling) instead of WebSocketProvider
 * because:
 * - HTTP is more reliable (no connection drops)
 * - ethers v6 polls for new events every ~4 seconds by default
 * - For our use case (whale detection), sub-second latency isn't needed
 * - WebSocket providers are prone to silent disconnection
 *
 * If you need faster detection, switch to WebSocketProvider with
 * a WebSocket-enabled RPC endpoint (Alchemy, Infura, etc.).
 *
 * Reconnection: If the provider disconnects, we wait 10 seconds
 * and try again. Max retries: 20 (then stop with error log).
 */
export async function startChainIndexer(): Promise<void> {
  if (isRunning) {
    log.warn('Chain indexer is already running');
    return;
  }

  log.info('Starting Polygon on-chain indexer...');

  try {
    // Create provider connected to Polygon RPC
    // ethers v6: JsonRpcProvider automatically handles polling
    provider = new ethers.JsonRpcProvider(env.POLYGON_RPC_URL);

    // Verify we can connect to the RPC node
    const blockNumber = await provider.getBlockNumber();
    log.info({ blockNumber, rpc: env.POLYGON_RPC_URL }, 'Connected to Polygon');

    // Create Contract instances bound to the exchange addresses
    // The ABI tells ethers how to decode the event logs
    ctfExchange = new ethers.Contract(
      POLYMARKET_CONTRACTS.CTF_EXCHANGE,
      CTF_EXCHANGE_ABI,
      provider,
    );

    negRiskExchange = new ethers.Contract(
      POLYMARKET_CONTRACTS.NEGRISK_CTF_EXCHANGE,
      CTF_EXCHANGE_ABI, // Same ABI — both contracts have OrderFilled
      provider,
    );

    // Start listening for events
    setupEventListeners();

    isRunning = true;
    log.info('Polygon on-chain indexer started successfully');
  } catch (err) {
    log.error({ err }, 'Failed to start chain indexer');

    // Retry connection after 10 seconds
    scheduleReconnect();
  }
}

/**
 * Schedules a reconnection attempt with backoff.
 */
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log.error('Max reconnection attempts reached for chain indexer');
    return;
  }

  const delay = Math.min(10000 * Math.pow(1.5, reconnectAttempts), 60000); // Max 60s
  reconnectAttempts++;

  log.info({ attempt: reconnectAttempts, delayMs: delay }, 'Scheduling chain indexer reconnect');

  reconnectTimer = setTimeout(async () => {
    isRunning = false;
    await startChainIndexer();
  }, delay);
}

/**
 * Gracefully stops the chain indexer.
 *
 * Removes all event listeners and destroys the provider connection.
 */
export function stopChainIndexer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ctfExchange) {
    ctfExchange.removeAllListeners();
    ctfExchange = null;
  }

  if (negRiskExchange) {
    negRiskExchange.removeAllListeners();
    negRiskExchange = null;
  }

  if (provider) {
    provider.destroy();
    provider = null;
  }

  isRunning = false;
  reconnectAttempts = 0;
  log.info('Polygon on-chain indexer stopped');
}
