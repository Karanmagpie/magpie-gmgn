// =============================================================
// Environment Configuration
// =============================================================
// Loads .env file and validates all required variables exist.
// If anything is missing, the server crashes immediately with
// a clear error message — "fail fast" so you know what's wrong.
//
// Usage: import { env } from './config/env';
//        console.log(env.DATABASE_URL);
// =============================================================

import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (two levels up from apps/server/src/)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const env = {
  // Database
  DATABASE_URL: requireEnv('DATABASE_URL'),
  REDIS_URL: requireEnv('REDIS_URL'),
  REDIS_PASSWORD: optionalEnv('REDIS_PASSWORD', ''),

  // Polygon blockchain RPC for on-chain indexing
  POLYGON_RPC_URL: optionalEnv('POLYGON_RPC_URL', 'https://polygon-rpc.com'),

  // Polymarket API endpoints
  POLYMARKET_GAMMA_API: optionalEnv('POLYMARKET_GAMMA_API', 'https://gamma-api.polymarket.com'),
  POLYMARKET_DATA_API: optionalEnv('POLYMARKET_DATA_API', 'https://data-api.polymarket.com'),
  POLYMARKET_CLOB_API: optionalEnv('POLYMARKET_CLOB_API', 'https://clob.polymarket.com'),
  POLYMARKET_CLOB_WS: optionalEnv('POLYMARKET_CLOB_WS', 'wss://ws-subscriptions-clob.polymarket.com/ws/market'),

  // Kalshi API endpoint
  KALSHI_API: optionalEnv('KALSHI_API', 'https://api.elections.kalshi.com/trade-api/v2'),

  // Whale detection threshold (configurable via .env)
  // Default: $10,000 (industry standard used by PolyTrack, Polywhaler)
  // Users can override per-alert via alert_configs table
  WHALE_THRESHOLD: parseInt(optionalEnv('WHALE_THRESHOLD', '10000'), 10),

  // HTTP API server port
  PORT: parseInt(optionalEnv('PORT', '3001'), 10),

  // BullMQ job schedules (in milliseconds for repeat intervals)
  // NOTE: All set to once per day to conserve free-tier DB storage + network
  // Phase 1
  MARKET_SYNC_INTERVAL_MS: 24 * 60 * 60 * 1000,   // 24 hours (was 5 min)
  TRADE_SYNC_INTERVAL_MS: 24 * 60 * 60 * 1000,    // 24 hours (was 1 min)
  WALLET_SYNC_INTERVAL_MS: 24 * 60 * 60 * 1000,   // 24 hours
  // Phase 2: Intelligence Layer
  WALLET_ENRICHMENT_INTERVAL_MS: 24 * 60 * 60 * 1000,   // 24 hours (was 5 min)
  POSITION_SYNC_INTERVAL_MS: 24 * 60 * 60 * 1000,       // 24 hours (was 5 min)
  SMART_SCORE_INTERVAL_MS: 24 * 60 * 60 * 1000,         // 24 hours (was 30 min)
  SAFETY_SCORE_INTERVAL_MS: 24 * 60 * 60 * 1000,        // 24 hours (was 10 min)
  CONSENSUS_INTERVAL_MS: 24 * 60 * 60 * 1000,           // 24 hours (was 2 min)
} as const;
