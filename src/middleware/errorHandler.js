/**
 * Central error handler - the single place an error turns into a response.
 *
 * Responsibilities:
 *   1. Translate known third-party errors (Mongoose, JWT, body-parser) into the
 *      project's own ApiError vocabulary.
 *   2. Guarantee the response envelope and a machine-readable `error.code`.
 *   3. Never leak internals. Unexpected errors are logged in full and returned
 *      as a bare 500; stack traces are only attached outside production.
 */
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError.js';
import { ERROR_CODES } from '../constants/errorCodes.js';
import { buildErrorBody } from '../utils/apiResponse.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** Maps a non-ApiError into an ApiError, or returns null if it is a real bug. */
const translate = (error) => {
  if (error instanceof ApiError) return error;

  // --- Mongoose: schema validation ---
  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((fieldError) => ({
      field: fieldError.path,
      message: fieldError.message,
    }));
    return ApiError.validation('The submitted data is invalid', details);
  }

  // --- Mongoose: malformed ObjectId in a path/filter ---
  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(
      `Invalid value for '${error.path}'`,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  // --- MongoDB: unique index violation ---
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? 'field';
    const code =
      field === 'email' ? ERROR_CODES.EMAIL_ALREADY_EXISTS : ERROR_CODES.CONFLICT;
    return ApiError.conflict(`A record with this ${field} already exists`, code);
  }

  // --- JWT ---
  if (error instanceof jwt.TokenExpiredError) {
    return ApiError.unauthorized('Access token has expired', ERROR_CODES.TOKEN_EXPIRED);
  }
  if (error instanceof jwt.JsonWebTokenError) {
    return ApiError.unauthorized('Access token is invalid', ERROR_CODES.TOKEN_INVALID);
  }

  // --- body-parser ---
  if (error?.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON');
  }
  if (error?.type === 'entity.too.large') {
    return ApiError.payloadTooLarge('Request body is too large');
  }

  return null;
};

// eslint-disable-next-line no-unused-vars -- Express identifies this by arity (4 args).
export const errorHandler = (error, req, res, next) => {
  const apiError = translate(error);

  if (!apiError) {
    logger.error(
      `[${req.id}] Unhandled error on ${req.method} ${req.originalUrl}:`,
      error,
    );

    const body = buildErrorBody({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong on our side',
      requestId: req.id,
    });
    if (!env.isProduction) body.error.debug = { message: error?.message, stack: error?.stack };
    return res.status(500).json(body);
  }

  // Expected failures are noise at error level; 5xx is not.
  if (apiError.statusCode >= 500) {
    logger.error(`[${req.id}] ${apiError.code}: ${apiError.message}`);
  } else {
    logger.debug(
      `[${req.id}] ${apiError.statusCode} ${apiError.code} on ${req.method} ${req.originalUrl}`,
    );
  }

  return res.status(apiError.statusCode).json(
    buildErrorBody({
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
      requestId: req.id,
    }),
  );
};

export default errorHandler;
