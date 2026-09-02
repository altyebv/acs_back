/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * pipeline instead of hanging the request.
 *
 * Express 4 does not await handlers, so every async controller must be wrapped:
 *   router.post('/login', asyncHandler(login));
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
