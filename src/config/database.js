/**
 * MongoDB connection lifecycle.
 */
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

/**
 * Opens the shared Mongoose connection.
 * @param {string} [uri] Overrides MONGODB_URI (used by the test harness).
 */
export const connectDatabase = async (uri = env.MONGODB_URI) => {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (error) => logger.error('MongoDB error:', error.message));

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 10,
  });

  return mongoose.connection;
};

export const disconnectDatabase = async () => {
  await mongoose.connection.close();
};

export default connectDatabase;
