/**
 * Environment configuration.
 *
 * Single source of truth for every value that comes from outside the code.
 * Nothing in `src/` should ever read `process.env` directly - import `env`
 * from here instead. The schema below fails fast at boot with a readable
 * message, so a misconfigured deployment never starts half-working.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  COOKIE_SECURE: booleanish.default('false'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),

  CORS_ORIGINS: csv.default('http://localhost:5173'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  GLOBAL_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(500),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  SEED_ADMIN_NAME: z.string().default('ACS Admin'),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO_USERS: booleanish.default('false'),
  SEED_DEMO_PASSWORD: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  // eslint-disable-next-line no-console
  console.error(
    `\nInvalid environment configuration:\n${issues}\n\n` +
      'Copy .env.example to .env and fill in the missing values.\n',
  );
  process.exit(1);
}

const raw = parsed.data;

export const env = Object.freeze({
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  /** Refresh token lifetime in milliseconds. */
  refreshTokenTtlMs: raw.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});

// A production deployment sending refresh cookies over plain HTTP is a bug,
// not a preference - refuse to start rather than silently leaking sessions.
if (env.isProduction && !env.COOKIE_SECURE) {
  // eslint-disable-next-line no-console
  console.error(
    '\nCOOKIE_SECURE must be true when NODE_ENV=production (refresh cookie requires HTTPS).\n',
  );
  process.exit(1);
}

export default env;
