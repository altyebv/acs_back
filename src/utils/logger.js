/**
 * Minimal level-aware logger.
 *
 * Deliberately dependency-free: swap the implementation for pino/winston in a
 * later sprint without touching any call site.
 */
import { env } from '../config/env.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[env.LOG_LEVEL] ?? LEVELS.info;

const emit = (level, stream, args) => {
  if (LEVELS[level] > threshold) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;
  // eslint-disable-next-line no-console
  console[stream](prefix, ...args);
};

export const logger = {
  error: (...args) => emit('error', 'error', args),
  warn: (...args) => emit('warn', 'warn', args),
  info: (...args) => emit('info', 'log', args),
  debug: (...args) => emit('debug', 'log', args),
};

export default logger;
