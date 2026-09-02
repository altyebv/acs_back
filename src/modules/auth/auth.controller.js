/**
 * Auth controllers - HTTP adapter over auth.service.
 *
 * Rules of the layer: read from req, call a service, send an envelope. No
 * business logic, no direct model access.
 */
import * as authService from './auth.service.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import {
  clearRefreshCookie,
  extractRefreshToken,
  setRefreshCookie,
} from '../../utils/tokens.js';
import { env } from '../../config/env.js';

/** Metadata recorded on the session, useful for auditing logins. */
const requestContext = (req) => ({
  userAgent: req.get('User-Agent') ?? null,
  ip: req.ip ?? null,
});

/**
 * POST /auth/login
 * Public. Sets the refresh cookie and returns the access token in the body.
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  const { user, accessToken, refreshToken } = await authService.login({
    email,
    password,
    context: requestContext(req),
  });

  setRefreshCookie(res, refreshToken);

  return sendSuccess(res, {
    user,
    accessToken,
    tokenType: 'Bearer',
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
};

/**
 * POST /auth/refresh
 * Public, but only succeeds with a valid refresh cookie. Rotates the cookie.
 */
export const refresh = async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.refresh({
    refreshToken: extractRefreshToken(req),
    context: requestContext(req),
  });

  setRefreshCookie(res, refreshToken);

  return sendSuccess(res, {
    user,
    accessToken,
    tokenType: 'Bearer',
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
};

/**
 * POST /auth/logout
 * Always answers 200: the client's goal is "be logged out", and it is, whether
 * or not the token it sent was still valid.
 */
export const logout = async (req, res) => {
  await authService.logout(extractRefreshToken(req));
  clearRefreshCookie(res);
  return sendSuccess(res, { message: 'Logged out successfully' });
};

/** POST /auth/logout-all - ends every session for the authenticated user. */
export const logoutAll = async (req, res) => {
  const revoked = await authService.logoutAll(req.user.id);
  clearRefreshCookie(res);
  return sendSuccess(res, { message: 'Logged out from all devices', revokedSessions: revoked });
};

/**
 * GET /auth/me
 * The frontend calls this on boot to rehydrate its auth state.
 */
export const me = async (req, res) => sendSuccess(res, { user: req.user });

/** GET /auth/sessions - the caller's active sessions. */
export const sessions = async (req, res) => {
  const list = await authService.listActiveSessions(req.user.id);
  return sendSuccess(
    res,
    list.map((session) => ({
      id: session._id.toString(),
      current: session.family === req.auth?.sessionFamily,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    })),
  );
};

/**
 * PATCH /auth/password
 * Changing a password logs every device out, including this one - the client
 * must send the user back to the login screen.
 */
export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  await authService.changePassword({
    userId: req.user.id,
    currentPassword,
    newPassword,
  });

  clearRefreshCookie(res);

  return sendSuccess(res, {
    message: 'Password changed successfully. Please log in again.',
  });
};
