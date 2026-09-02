/**
 * Rate limiters.
 *
 * Limits are keyed by IP and email together, so one attacker cannot lock every user out by spraying a
 * single address, and one shared office IP does not lock out its colleagues.
 */
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ERROR_CODES } from '../constants/errorCodes.js';

const envelope = (message) => ({
  success: false,
  error: { code: ERROR_CODES.RATE_LIMITED, message },
});

export const globalLimiter = rateLimit({
  windowMs: env.GLOBAL_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: env.GLOBAL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Health checks should never be throttled.
  skip: (req) => req.path === '/health' || req.path.endsWith('/health'),
  message: envelope('Too many requests. Please slow down and try again shortly.'),
});

export const loginLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // A successful login should not count against the limit.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
  message: envelope(
    'Too many login attempts. Please wait a few minutes before trying again.',
  ),
});

export default { globalLimiter, loginLimiter };
