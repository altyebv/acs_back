/**
 * The response envelope.
 *
 * EVERY response from this API - success or failure - has this shape, so the
 * frontend can write one interceptor and be done:
 *
 *   success: { "success": true,  "data": <payload>, "meta": <optional> }
 *   failure: { "success": false, "error": { "code", "message", "details"? } }
 *
 * Do not hand-roll `res.json({...})` in a controller; go through these helpers.
 */

/**
 * @param {import('express').Response} res
 * @param {unknown} data Payload placed under `data`.
 * @param {object} [options]
 * @param {number} [options.status=200]
 * @param {object} [options.meta] Pagination or other envelope-level metadata.
 */
export const sendSuccess = (res, data = null, { status = 200, meta } = {}) => {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};

export const sendCreated = (res, data, options = {}) =>
  sendSuccess(res, data, { ...options, status: 201 });

export const sendNoContent = (res) => res.status(204).send();

/**
 * Builds the error half of the envelope. Used by the central error handler;
 * controllers should throw an ApiError instead of calling this directly.
 */
export const buildErrorBody = ({ code, message, details, requestId }) => {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  const body = { success: false, error };
  if (requestId) body.requestId = requestId;
  return body;
};

/** Standard pagination metadata for list endpoints. */
export const buildPaginationMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasNextPage: page * limit < total,
  hasPrevPage: page > 1,
});
