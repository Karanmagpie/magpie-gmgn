// =============================================================
// Logger (pino)
// =============================================================
// pino is the fastest Node.js logger (~5x faster than winston).
// In development: colorful, human-readable output via pino-pretty.
// In production: structured JSON for log aggregation services.
//
// Usage:
//   import { logger } from './utils/logger';
//   logger.info('Market synced');
//   logger.info({ marketCount: 150 }, 'Polymarket sync complete');
//   logger.error({ err }, 'Failed to sync markets');
// =============================================================

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

/**
 * Create a child logger with a component name.
 * Useful for identifying which part of the system logged a message.
 *
 * Example:
 *   const log = createLogger('polymarket-sync');
 *   log.info('Starting sync...'); // → [polymarket-sync] Starting sync...
 */
export function createLogger(component: string) {
  return logger.child({ component });
}
