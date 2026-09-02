/**
 * Token primitives.
 *
 * Two different kinds of token, by design:
 *
 *   ACCESS  - a short-lived signed JWT (default 15m). Sent by the client in the
 *             `Authorization: Bearer <token>` header. Stateless: verifying it
 *             costs no database round-trip, which is why it must be short.
 *
 *   REFRESH - 64 random bytes, NOT a JWT. It carries no claims and means
 *             nothing on its own; its only power is matching a row in the
 *             sessions collection. Travels in an httpOnly cookie, so page
 *             JavaScript (and therefore an XSS payload) cannot read it.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const REFRESH_COOKIE_NAME = 'acs_refresh_token';

/**
 * Signs an access token.
 * Keep the payload small and non-sensitive - a JWT is signed, not encrypted,
 * and anyone holding it can read its contents.
 */
export const signAccessToken = ({ userId, role, sessionFamily }) =>
  jwt.sign(
    { sub: String(userId), role, fam: sessionFamily, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL, issuer: 'acs-api', audience: 'acs-client' },
  );

/** Verifies an access token. Throws jwt errors, which the error handler maps. */
export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'acs-api',
    audience: 'acs-client',
  });

/** Generates a raw refresh token plus the hash that gets persisted. */
export const generateRefreshToken = () => {
  const token = crypto.randomBytes(64).toString('hex');
  return { token, tokenHash: hashRefreshToken(token) };
};

export const hashRefreshToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

/** A new session family id, shared by every rotation from one login. */
export const generateSessionFamily = () => crypto.randomUUID();

/** Cookie options shared by the set and clear calls - they must match exactly. */
export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  // Scoped to the auth routes: the cookie is not attached to ordinary API
  // calls, which shrinks its exposure and its CSRF surface.
  path: `${env.API_PREFIX}/auth`,
});

export const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieOptions(),
    maxAge: env.refreshTokenTtlMs,
  });
};

export const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
};

/**
 * Reads the refresh token. The cookie is authoritative; the body fallback
 * exists only for non-browser clients (Postman, mobile, integration tests).
 */
export const extractRefreshToken = (req) =>
  req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken || null;
