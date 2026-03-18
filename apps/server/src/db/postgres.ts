// =============================================================
// PostgreSQL Connection (pg)
// =============================================================
// Uses a connection POOL — keeps 20 database connections open
// and reuses them. This is WAY faster than opening a new
// connection for every query.
//
// pg docs: https://node-postgres.com/
//
// Usage:
//   import { db } from './db/postgres';
//   const result = await db.query('SELECT * FROM markets LIMIT 10');
//   console.log(result.rows);
// =============================================================

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('postgres');

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  // Reduced pool size for Railway free tier (1GB memory limit)
  max: 5,                   // max 5 simultaneous connections
  idleTimeoutMillis: 30000, // close idle connections after 30s
  connectionTimeoutMillis: 10000, // 10s timeout for Railway cold starts
});

// Log when pool connects and errors
db.on('connect', () => {
  log.debug('New client connected to pool');
});

db.on('error', (err) => {
  log.error({ err }, 'Unexpected PostgreSQL pool error');
});

/**
 * Test database connectivity. Call this on startup.
 * Throws if the database is unreachable.
 */
export async function testConnection(): Promise<void> {
  const client = await db.connect();
  try {
    const result = await client.query('SELECT NOW() as time');
    log.info({ time: result.rows[0].time }, 'PostgreSQL connected');
  } finally {
    client.release();
  }
}

/**
 * Runs all SQL migration files from the migrations directory.
 * Files are executed in alphabetical order (001_, 002_, etc.).
 * Safe to run multiple times — uses IF NOT EXISTS in the SQL.
 *
 * Each statement runs individually with a lock timeout to prevent
 * deadlocks with stale connections from previous server runs.
 */
export async function runMigration(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    // Split into individual statements to avoid holding multiple locks
    // at once (which caused deadlocks when stale connections existed).
    const statements = sql
      .split(';')
      .map((s) => {
        // Strip leading comment lines so statements like "-- comment\nCREATE TABLE..."
        // don't get filtered out (the comment is not the statement)
        return s.split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim();
      })
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        // Set a lock timeout so ALTER TABLE doesn't wait forever
        // if stale connections hold locks from previous runs
        await db.query('SET lock_timeout = \'10s\'');
        await db.query(stmt);
      } catch (err: any) {
        // If lock timeout, terminate stale backends and retry once
        if (err.code === '55P03' || err.message?.includes('deadlock')) {
          log.warn({ stmt: stmt.substring(0, 80) }, 'Lock conflict during migration — terminating stale backends and retrying');
          await db.query(`
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND state = 'idle'
              AND state_change < NOW() - INTERVAL '30 seconds'
          `);
          // Wait briefly for locks to release
          await new Promise((r) => setTimeout(r, 1000));
          await db.query(stmt);
        } else {
          throw err;
        }
      }
    }

    // Reset lock timeout to default
    await db.query('SET lock_timeout = 0');
    log.info({ file }, 'Migration applied');
  }
}

/**
 * Gracefully close all pool connections.
 * Call this on server shutdown.
 */
export async function closePool(): Promise<void> {
  await db.end();
  log.info('PostgreSQL pool closed');
}
