/**
 * authorize WHAT an authenticated caller have access to.
 *
 * This is the enforcement point. every protected route re-checks the role
 * here, server-side, on every single request.
 *
 * Always mount after `authenticate`:
 *   router.get('/', authenticate, authorize(ROLES.ADMIN), handler);
 */
import { ApiError } from '../utils/ApiError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { ROLES } from '../constants/roles.js';

/**
 * Allows only the listed roles.
 * @param {...string} allowedRoles Values from ROLES.
 */
export const authorize = (...allowedRoles) => {
  const allowed = allowedRoles.flat();

  if (allowed.length === 0) {
    throw new Error('authorize() requires at least one role');
  }

  return (req, res, next) => {
    // Guards against a route being wired up without authenticate in front.
    if (!req.user) {
      return next(
        ApiError.unauthorized('Authentication required', ERROR_CODES.AUTH_REQUIRED),
      );
    }

    if (!allowed.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          'Your role does not have access to this resource',
          ERROR_CODES.INSUFFICIENT_ROLE,
          { requiredRoles: allowed, yourRole: req.user.role },
        ),
      );
    }

    return next();
  };
};

/** Shorthands for the common cases. */
export const adminOnly = authorize(ROLES.ADMIN);
export const judgeOnly = authorize(ROLES.JUDGE);
export const contestantOnly = authorize(ROLES.CONTESTANT);

/**
 * Allows admins, or the user acting on their own record.
 *
 * Ownership beyond "is this my user id" (a contestant's own submission, a
 * judge's own scores) belongs in the owning module's service, where the
 * resource is loaded - not here.
 *
 * @param {string} [param='id'] Route param holding the target user id.
 */
export const authorizeSelfOrAdmin = (param = 'id') => (req, res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required', ERROR_CODES.AUTH_REQUIRED));
  }

  const isSelf = req.params[param] === req.user.id;
  if (isSelf || req.user.role === ROLES.ADMIN) return next();

  return next(
    ApiError.forbidden('You can only access your own account', ERROR_CODES.FORBIDDEN),
  );
};

export default authorize;
