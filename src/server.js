/**
 * Process entry point: connect to MongoDB, then start listening.
 *
 * The order is intentional - the server does not accept traffic until the
 * database is reachable, so a booting instance never answers requests it cannot
 * fulfil.
 */
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const start = async () => {
  try {
    await connectDatabase();
  } catch (error) {
    logger.error('Could not connect to MongoDB:', error.message);
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`ACS API listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
    logger.info(`Environment: ${env.NODE_ENV}`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Do not hang forever on a stuck connection.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
  });
};

start();
