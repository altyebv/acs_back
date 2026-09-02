/**
 * Submission - PLACEHOLDER  not an implementation.
 *
 * -----------------------------------------------------------------------------
 * Scope note: this file exists only so the file-storage module has a stable
 * document to attach file references to during phase 1. It is intentionally
 * minimal and has NO routes, controller or service. The module owner is free to
 * extend or replace it - the only things other modules currently rely on are
 * the `contestant` reference and the `status` values.
 *
 * The storage module is expected to own its own `File` model and either:
 *    hold `submission: ObjectId` on each file document (preferred), or
 *    push file ids onto `Submission.files` here.
 * Nothing in the auth foundation reads this model.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

export const SUBMISSION_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  SCORED: 'scored',
});

const submissionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    contestant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(SUBMISSION_STATUS),
      default: SUBMISSION_STATUS.DRAFT,
      index: true,
    },
    submittedAt: { type: Date, default: null },
    /** Owned by the file-storage module; left loose on purpose. */
    files: [{ type: mongoose.Schema.Types.ObjectId, ref: 'File' }],
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
  },
);

export const Submission = mongoose.model('Submission', submissionSchema);
export default Submission;
