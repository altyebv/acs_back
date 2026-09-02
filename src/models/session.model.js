/**
 * Session - one row for issued refresh token.
 *
 * Why a DB record instead of a self-contained refresh JWT: a stateless refresh
 * token cannot be revoked. With a session row, logout, "log out everywhere",
 * disabling an account and detecting a stolen token all become real operations.
 *
 * Token handling:
 *   - The raw refresh token is random bytes; only its SHA-256 hash is stored.
 *     A dump of this collection therefore cannot be replayed against the API.
 *   - Every refresh ROTATES the token: the old row is revoked and points at its
 *     replacement. All rows from one login share a `family` id.
 *   - Presenting an already-rotated token means the token was stolen and
 *     replayed, so the whole family is revoked and the user must log in again.
 *
 * Expired rows are removed automatically by a TTL index on `expiresAt`.
 */
import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** SHA-256 of the raw refresh token. The raw value is never persisted. */
    tokenHash: { type: String, required: true, unique: true },
    /** Shared by every rotation descended from a single login. */
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    /** Why the session ended - useful when debugging surprise logouts. */
    revokedReason: {
      type: String,
      enum: ['logout', 'logout_all', 'rotated', 'reuse_detected', 'password_changed', 'account_disabled', null],
      default: null,
    },
    replacedByTokenHash: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 512 },
    ip: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        // Never expose the hash, not even to the session owner.
        delete ret.tokenHash;
        delete ret.replacedByTokenHash;
        return ret;
      },
    },
  },
);

// MongoDB reaps documents once `expiresAt` passes, keeping the collection small.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ user: 1, revokedAt: 1 });

sessionSchema.virtual('isActive').get(function isActive() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
});

export const Session = mongoose.model('Session', sessionSchema);
export default Session;
