/**
 * User management service (admin surface).
 *
 * Guards worth noting: an admin cannot demote, disable or delete their own
 * account, and the system refuses to remove or demote its last active admin -
 * both are one-click ways to lock everybody out of the platform permanently.
 */
import { User } from '../../models/user.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../constants/errorCodes.js';
import { ROLES } from '../../constants/roles.js';
import { logoutAll } from '../auth/auth.service.js';

/** Escapes user input before it is used inside a RegExp. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const countOtherActiveAdmins = (excludeId) =>
  User.countDocuments({ role: ROLES.ADMIN, isActive: true, _id: { $ne: excludeId } });

/** Throws when the change would leave the platform with no active admin. */
const assertNotLastAdmin = async (user) => {
  if (user.role !== ROLES.ADMIN || !user.isActive) return;

  const remaining = await countOtherActiveAdmins(user._id);
  if (remaining === 0) {
    throw ApiError.conflict(
      'This is the last active admin account. Create another admin first.',
      ERROR_CODES.LAST_ADMIN,
    );
  }
};

export const createUser = async ({ name, email, password, role, isActive }, actorId) => {
  const existing = await User.findOne({ email }).select('_id').lean();
  if (existing) {
    throw ApiError.conflict('An account with this email already exists', ERROR_CODES.EMAIL_ALREADY_EXISTS);
  }

  return User.create({ name, email, password, role, isActive, createdBy: actorId });
};

export const listUsers = async ({ page, limit, role, isActive, search, sort }) => {
  const filter = {};
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  const [items, total] = await Promise.all([
    User.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  return { items, total };
};

export const getUserById = async (id) => {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);
  return user;
};

export const updateUser = async (id, updates, actorId) => {
  const user = await getUserById(id);

  if (updates.role && updates.role !== user.role) {
    if (String(user._id) === String(actorId)) {
      throw ApiError.badRequest('You cannot change your own role', ERROR_CODES.CANNOT_MODIFY_SELF);
    }
    await assertNotLastAdmin(user);
  }

  if (updates.email && updates.email !== user.email) {
    const taken = await User.findOne({ email: updates.email, _id: { $ne: user._id } })
      .select('_id')
      .lean();
    if (taken) {
      throw ApiError.conflict('An account with this email already exists', ERROR_CODES.EMAIL_ALREADY_EXISTS);
    }
  }

  Object.assign(user, updates);
  await user.save();
  return user;
};

/**
 * Enables or disables an account.
 * Disabling revokes every session immediately - a disabled user must not keep
 * working until their access token happens to expire.
 */
export const setUserStatus = async (id, isActive, actorId) => {
  const user = await getUserById(id);

  if (String(user._id) === String(actorId)) {
    throw ApiError.badRequest('You cannot change your own account status', ERROR_CODES.CANNOT_MODIFY_SELF);
  }

  if (!isActive) await assertNotLastAdmin(user);

  user.isActive = isActive;
  await user.save();

  if (!isActive) await logoutAll(user._id, 'account_disabled');

  return user;
};

/** Admin-set password. Also ends the target's sessions. */
export const resetPassword = async (id, newPassword) => {
  const user = await User.findById(id).select('+password');
  if (!user) throw ApiError.notFound('User not found', ERROR_CODES.USER_NOT_FOUND);

  user.password = newPassword;
  await user.save();
  await logoutAll(user._id, 'password_changed');

  return user;
};

export const deleteUser = async (id, actorId) => {
  const user = await getUserById(id);

  if (String(user._id) === String(actorId)) {
    throw ApiError.badRequest('You cannot delete your own account', ERROR_CODES.CANNOT_MODIFY_SELF);
  }

  await assertNotLastAdmin(user);
  await logoutAll(user._id, 'account_disabled');
  await user.deleteOne();
};
