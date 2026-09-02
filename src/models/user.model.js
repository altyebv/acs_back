/**
 * User - the single account model for all three roles.
 *
 * Security notes:
 *   - `password` has `select: false`; it is never loaded unless a query asked
 *     with `.select('+password')`. That makes leaking a hash the exception , not the default.
 *   - `toJSON` strips the hash and `__v` and renames `_id` to `id`, so handing a
 *     user document straight to res.json() is safe.
 *   - `passwordChangedAt` lets the auth middleware reject access tokens that
 *     were issued before the last password change.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLE_VALUES, ROLES } from '../constants/roles.js';
import { env } from '../config/env.js';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [120, 'Name must be at most 120 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email format is invalid'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: { values: ROLE_VALUES, message: '{VALUE} is not a valid role' },
      default: ROLES.CONTESTANT,
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.password;
        return ret;
      },
    },
  },
);

// Supports the common admin listing: "active judges, newest first".
userSchema.index({ role: 1, isActive: 1, createdAt: -1 });

/** Hash on create and on any password change - never store plaintext. */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, env.BCRYPT_ROUNDS);

  // Backdate one second: the JWT `iat` claim has second precision, so a token
  // minted in the same second as the change would otherwise look "too old".
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);

  return next();
});

/** Constant-time password comparison. */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

/**
 * True when the password changed after the given JWT `iat` (seconds).
 * Used to invalidate access tokens issued before a password change.
 */
userSchema.methods.passwordChangedAfter = function passwordChangedAfter(issuedAtSeconds) {
  if (!this.passwordChangedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > issuedAtSeconds;
};

export const User = mongoose.model('User', userSchema);
export default User;
