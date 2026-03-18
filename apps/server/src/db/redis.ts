// =============================================================
// Redis Connection (ioredis)
// =============================================================
// Redis serves multiple roles in MarkyPie:
//
// 1. CACHE — Live market prices with short TTL (60s)
//    So the dashboard doesn't hit PostgreSQL on every page load.
//
// 2. REAL-TIME FEEDS — Whale trade feed (Redis List)
//    LPUSH new whale trades, LTRIM to keep last 100.
//    Way faster than querying PostgreSQL for "latest 100 whale trades".
//
// 3. LEADERBOARD — Sorted Sets
//    ZADD wallet scores, ZREVRANGE to get top traders.
//    Redis sorted sets are O(log N) — instant leaderboard queries.
//
// 4. JOB QUEUE — BullMQ stores its jobs in Redis
//    Scheduled syncs, retries, rate limiting — all persisted in Redis.
//
// 5. PUB/SUB — Real-time WebSocket broadcasting
//    When a whale trade happens, publish to Redis channel,
//    all connected WebSocket servers pick it up and broadcast to users.
//
// ioredis docs: https://github.com/redis/ioredis
// =============================================================

import Redis from 'ioredis';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('redis');

// Parse REDIS_URL to get connection details
// Also accepts REDIS_PASSWORD as an explicit override (for Railway compatibility)
function buildRedisOptions() {
  const url = new URL(env.REDIS_URL);
  const password = env.REDIS_PASSWORD || (url.password ? decodeURIComponent(url.password) : undefined);

  // Debug log — masked password so it's safe to print
  log.info({
    host: url.hostname,
    port: url.port || '6379',
    protocol: url.protocol,
    hasPassword: !!password,
    passwordLength: password?.length ?? 0,
    hasRedisPasswordEnv: !!env.REDIS_PASSWORD,
    rawUrlPrefix: env.REDIS_URL.substring(0, 20) + '...',
  }, 'Redis connection config');

  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password,
    tls: url.protocol === 'rediss:' ? {} as any : undefined,
  };
}

export const redis = new Redis({
  ...buildRedisOptions(),
  maxRetriesPerRequest: null,  // Required by BullMQ — let BullMQ handle retries
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 30000);
    log.warn({ attempt: times, delay }, 'Redis reconnecting...');
    return delay;
  },
});

redis.on('connect', () => {
  log.info('Redis connected');
});

redis.on('error', (err) => {
  log.error({ err }, 'Redis connection error');
});

redis.on('close', () => {
  log.warn('Redis connection closed');
});

/**
 * Test Redis connectivity. Call this on startup.
 */
export async function testRedisConnection(): Promise<void> {
  const pong = await redis.ping();
  log.info({ response: pong }, 'Redis ping successful');
}

/**
 * Gracefully close the Redis connection.
 */
export async function closeRedis(): Promise<void> {
  await redis.quit();
  log.info('Redis connection closed');
}
