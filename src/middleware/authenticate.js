/**
 * authenticate  WHO the caller is.
 *
 * On success it attaches:
 *   req.user - the full Mongoose user document (password never loaded)
 *   req.auth - { sessionFamily, issuedAt } from the token claims
 *
 * A valid signature alone is not enough. Between minting a token and using it,
 * the account may have been disabled or its password changed, so the current
 * user record is loaded and re-checked on every request. That costs one indexed
 * lookup - the correct trade for a system where an admin disabling an account
 * must take effect immediately rather than in fifteen minutes.
 */
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Pulls the bearer token out of the Authorization header. */
const extractBearerToken = (req) => {
  const header = req.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
};

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    throw ApiError.unauthorized(
      'Authentication required. Provide an Authorization: Bearer <token> header.',
      ERROR_CODES.AUTH_REQUIRED,
    );
  }

  // Throws TokenExpiredError / JsonWebTokenError; the error handler maps both
  // to TOKEN_EXPIRED / TOKEN_INVALID, and the frontend refreshes on the former.
  const payload = verifyAccessToken(token);

  if (payload.type !== 'access') {
    throw ApiError.unauthorized('Wrong token type', ERROR_CODES.TOKEN_INVALID);
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw ApiError.unauthorized('The account for this token no longer exists', ERROR_CODES.TOKEN_INVALID);
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      'This account has been disabled. Please contact an administrator.',
      ERROR_CODES.ACCOUNT_DISABLED,
    );
  }

  if (user.passwordChangedAfter(payload.iat)) {
    throw ApiError.unauthorized(
      'Password was changed after this token was issued. Please log in again.',
      ERROR_CODES.PASSWORD_CHANGED,
    );
  }

  req.user = user;
  req.auth = { sessionFamily: payload.fam, issuedAt: payload.iat };

  return next();
});

/**
 * optionalAuthenticate - populates req.user when a valid token is present and
 * moves on quietly when it is not. For endpoints that show more to a logged-in
 * caller but are still readable by anyone.
 */
export const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  if (!extractBearerToken(req)) return next();
  return authenticate(req, res, next);
});

export default authenticate;
