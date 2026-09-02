/**
 * Terminal 404 handler - mounted after every route so an unknown path returns
 * the same envelope as any other error rather than Express's HTML page.
 */
import { ApiError } from '../utils/ApiError.js';

export const notFound = (req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
};

export default notFound;
