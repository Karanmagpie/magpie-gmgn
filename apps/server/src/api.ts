// =============================================================
// Hono API Application
// =============================================================
//
// WHAT: Sets up the HTTP API server that the Next.js frontend
//       (and external clients) consume.
//
// WHY:  All Phase 1/2 data (markets, wallets, trades, scores,
//       consensus) lives in PostgreSQL/Redis with no HTTP access.
//       This is the layer that exposes it.
//
// HOW:  Hono framework — TypeScript-native, ~3x faster than
//       Express, Web Standards Request/Response objects.
//       Listens on PORT 3001 (Next.js uses 3000).
//
// ROUTES:
//   /api/markets/*       — market listing, detail, trades
//   /api/wallets/*       — leaderboard, profiles, positions
//   /api/trades          — recent trades feed
//   /api/intelligence/*  — consensus, arbitrage signals
//
// MIDDLEWARE:
//   CORS     — allow localhost:3000 (Next.js dev) + any origin in prod
//   Logger   — log every request with method, path, status, duration
//   Errors   — catch all unhandled errors, return JSON error shape
// =============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { marketsRouter } from './routes/markets';
import { walletsRouter } from './routes/wallets';
import { tradesRouter } from './routes/trades';
import { intelligenceRouter } from './routes/intelligence';
import { createLogger } from './utils/logger';

const log = createLogger('api');

// Create the Hono app
export const app = new Hono();

// =============================================================
// Middleware
// =============================================================

// CORS — allow Next.js frontend on localhost:3000 during dev,
// and any https origin in production (expand when deploying)
app.use('*', cors({
  origin: (origin) => {
    // Allow localhost (any port) and any https origin
    if (!origin) return '*';
    if (origin.startsWith('http://localhost') || origin.startsWith('https://')) {
      return origin;
    }
    return null;
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600,
}));

// Request logger — prints: GET /api/markets 200 12ms
app.use('*', logger((message) => log.info(message)));

// =============================================================
// Health check — quick ping to verify server is alive
// =============================================================
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =============================================================
// Route groups
// =============================================================
app.route('/api/markets', marketsRouter);
app.route('/api/wallets', walletsRouter);
app.route('/api/trades', tradesRouter);
app.route('/api/intelligence', intelligenceRouter);

// =============================================================
// 404 handler — any path not matched above
// =============================================================
app.notFound((c) => {
  return c.json({ data: null, error: `Route not found: ${c.req.method} ${c.req.path}` }, 404);
});

// =============================================================
// Global error handler — catches unhandled errors in routes
// =============================================================
app.onError((err, c) => {
  log.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled API error');
  return c.json(
    { data: null, error: 'Internal server error' },
    500
  );
});
