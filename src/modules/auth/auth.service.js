/**
 * Auth service - all authentication business rules live here.
 *
 * Controllers stay thin: they translate HTTP to arguments and back. Nothing in
 * this file touches `req` or `res`, which is what makes these rules testable
 * and reusable (the seed script, for instance, uses the same User model rules).
 */
import bcrypt from 'bcryptjs';
import { User } from '../../models/user.model.js';
import { Session } from '../../models/session.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  generateRefreshToken,
  generateSessionFamily,
  hashRefreshToken,
  signAccessToken,
} from '../../utils/tokens.js';

/**
 * A valid bcrypt hash of a value nobody knows. Compared against when the email
 * does not exist, so "unknown account" costs the same time as "wrong password"
 * and cannot be distinguished by timing.
 */
const DUMMY_HASH = '$2a$12$PWealCN8O0.xnZIQIZynjufWaMAIQEvNo/4yI0a2jB1//qAyLMsqO';

/** Creates a session row and returns the raw refresh token to hand to the client. */
const issueSession = async ({ userId, family, context = {} }) => {
  const { token, tokenHash } = generateRefreshToken();

  await Session.create({
    user: userId,
    tokenHash,
    family,
    expiresAt: new Date(Date.now() + env.refreshTokenTtlMs),
    userAgent: context.userAgent?.slice(0, 512) ?? null,
    ip: context.ip ?? null,
  });

  return token;
};

/**
 * Verifies credentials and starts a new session.
 *
 * The failure path is deliberately uniform: a missing account, a wrong password
 * and a malformed record all produce the same 401 INVALID_CREDENTIALS. Telling
 * the caller which one it was turns the login form into an account enumerator.
 * A disabled account is the one exception - that message is actionable and
 * reveals nothing an attacker could not learn by trying to log in anyway.
 */
export const login = async ({ email, password, context }) => {
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    // Burn the same time a real comparison would, then fail identically.
    await bcrypt.compare(password, DUMMY_HASH);
    throw ApiError.unauthorized('Email or password is incorrect', ERROR_CODES.INVALID_CREDENTIALS);
  }

  const passwordMatches = await user.comparePassword(password);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Email or password is incorrect', ERROR_CODES.INVALID_CREDENTIALS);
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      'This account has been disabled. Please contact an administrator.',
      ERROR_CODES.ACCOUNT_DISABLED,
    );
  }

  const family = generateSessionFamily();
  const refreshToken = await issueSession({ userId: user._id, family, context });
  const accessToken = signAccessToken({ userId: user._id, role: user.role, sessionFamily: family });

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  return { user, accessToken, refreshToken };
};

/**
 * Exchanges a refresh token for a fresh pair, rotating the old one.
 *
 * Reuse detection: if the presented token exists but is already revoked, it was
 * replayed - either by an attacker who captured it or by a client that kept a
 * copy. We cannot tell which, so we assume the worst and kill the entire family,
 * forcing a real login.
 */
export const refresh = async ({ refreshToken, context }) => {
  if (!refreshToken) {
    throw ApiError.unauthorized('No refresh token provided', ERROR_CODES.REFRESH_TOKEN_MISSING);
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const session = await Session.findOne({ tokenHash });

  if (!session) {
    throw ApiError.unauthorized('Refresh token is invalid', ERROR_CODES.REFRESH_TOKEN_INVALID);
  }

  if (session.revokedAt) {
    logger.warn(
      `Refresh token reuse detected for user ${session.user} (family ${session.family}) - revoking family`,
    );
    await Session.updateMany(
      { family: session.family, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'reuse_detected' } },
    );
    throw ApiError.unauthorized(
      'This session is no longer valid. Please log in again.',
      ERROR_CODES.SESSION_REVOKED,
    );
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Session has expired. Please log in again.', ERROR_CODES.SESSION_REVOKED);
  }

  const user = await User.findById(session.user);
  if (!user || !user.isActive) {
    await Session.updateMany(
      { family: session.family, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'account_disabled' } },
    );
    throw ApiError.unauthorized(
      'This account is no longer active',
      ERROR_CODES.ACCOUNT_DISABLED,
    );
  }

  // Rotate: the old token dies the moment a new one is minted.
  const newRefreshToken = await issueSession({ userId: user._id, family: session.family, context });

  session.revokedAt = new Date();
  session.revokedReason = 'rotated';
  session.replacedByTokenHash = hashRefreshToken(newRefreshToken);
  await session.save();

  const accessToken = signAccessToken({
    userId: user._id,
    role: user.role,
    sessionFamily: session.family,
  });

  return { user, accessToken, refreshToken: newRefreshToken };
};

/** Ends one session. Idempotent - logging out twice is not an error. */
export const logout = async (refreshToken) => {
  if (!refreshToken) return;

  await Session.updateOne(
    { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
  );
};

/** Ends every session for a user (all devices). */
export const logoutAll = async (userId, reason = 'logout_all') => {
  const result = await Session.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return result.modifiedCount ?? 0;
};

/**
 * Changes the caller's own password and terminates every existing session.
 * Requiring the current password means a stolen access token alone cannot be
 * used to take over the account permanently.
 */
export const changePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
  }

  const matches = await user.comparePassword(currentPassword);
  if (!matches) {
    throw ApiError.unauthorized('Current password is incorrect', ERROR_CODES.INVALID_CREDENTIALS);
  }

  if (await user.comparePassword(newPassword)) {
    throw ApiError.badRequest('New password must be different from the current one');
  }

  user.password = newPassword;
  await user.save();

  await logoutAll(user._id, 'password_changed');

  return user;
};

/** Active sessions for a user - powers a "where am I logged in" screen. */
export const listActiveSessions = (userId) =>
  Session.find({ user: userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .lean({ virtuals: false });
