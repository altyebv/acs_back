/**
 * Express application assembly.
 *
 * Kept separate from server.js so tests can import a fully wired app without
 * opening a port or a database connection.
 *
 * Middleware order matters:
 *   requestId -> security headers -> CORS -> body/cookie parsing ->
 *   logging -> rate limiting -> routes -> 404 -> error handler.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { requestId } from './middleware/requestId.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimiters.js';
import { ERROR_CODES } from './constants/errorCodes.js';

export const createApp = () => {
  const app = express();

  // Behind a reverse proxy (nginx, Render, Railway), trust it so req.ip is the
  // real client address - the rate limiter keys on it.
  if (env.isProduction) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());

  // CORS. `credentials: true` is required for the refrsh cookie to travel, and
  // it forbids the `*` origin - hence the explicit allow-list.
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser clients (curl, Postman) send no Origin.
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  if (!env.isTest) {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  app.use(globalLimiter);

  // Plain health check outside the API prefix, for load balancers.
  app.get('/health', (req, res) => res.status(200).json({ success: true, data: { status: 'ok' } }));

  app.use(env.API_PREFIX, apiRoutes);

  // A rejected CORS origin arrives here as a generic Error; give it a real code.
  app.use((error, req, res, next) => {
    if (error?.message?.includes('is not allowed by CORS')) {
      return res.status(403).json({
        success: false,
        error: { code: ERROR_CODES.FORBIDDEN, message: 'Origin not allowed' },
      });
    }
    return next(error);
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

export default createApp;
