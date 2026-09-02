/**
 * ApiError - the only error type controllers and services should throw.
 *
 * Anything thrown that is NOT an ApiError is treated by the error handler as an
 * unexpected bug: it is logged in full and reported to the client as a generic
 * 500, so internal details (stack traces, driver messages, file paths) never
 * leak into a response.
 */
import { ERROR_CODES } from '../constants/errorCodes.js';

export class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status.
   * @param {string} code Machine-readable code from ERROR_CODES.
   * @param {string} message Human-readable message, safe to show to a user.
   * @param {unknown} [details] Optional structured detail (e.g. field errors).
   */
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  // --- 400 ---
  static badRequest(message = 'Bad request', code = ERROR_CODES.BAD_REQUEST, details) {
    return new ApiError(400, code, message, details);
  }

  static validation(message = 'Validation failed', details) {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }

  // --- 401 ---
  static unauthorized(message = 'Authentication required', code = ERROR_CODES.AUTH_REQUIRED) {
    return new ApiError(401, code, message);
  }

  // --- 403 ---
  static forbidden(message = 'You do not have permission to perform this action', code = ERROR_CODES.FORBIDDEN, details) {
    return new ApiError(403, code, message, details);
  }

  // --- 404 ---
  static notFound(message = 'Resource not found', code = ERROR_CODES.NOT_FOUND) {
    return new ApiError(404, code, message);
  }

  // --- 409 ---
  static conflict(message = 'Resource already exists', code = ERROR_CODES.CONFLICT, details) {
    return new ApiError(409, code, message, details);
  }

  // --- 413 ---
  static payloadTooLarge(message = 'Payload too large', code = ERROR_CODES.PAYLOAD_TOO_LARGE, details) {
    return new ApiError(413, code, message, details);
  }

  // --- 429 ---
  static tooManyRequests(message = 'Too many requests, please try again later') {
    return new ApiError(429, ERROR_CODES.RATE_LIMITED, message);
  }

  // --- 500 ---
  static internal(message = 'Something went wrong') {
    return new ApiError(500, ERROR_CODES.INTERNAL_ERROR, message);
  }
}

export default ApiError;
