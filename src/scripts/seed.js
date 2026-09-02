/**
 * Seed script  bootstraps the first admin so the platform can start and tested better.
 *
 *   npm run seed         create missing accounts, leave existing ones alone
 *   npm run seed:reset   delete all users and sessions first (DEV ONLY)
 *
 * Credentials come from .env (SEED_ADMIN_*), never from this file. The reset
 * flag refuses to run against NODE_ENV=production.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { Session } from '../models/session.model.js';
import { ROLES } from '../constants/roles.js';
import { logger } from '../utils/logger.js';

const shouldReset = process.argv.includes('--reset');

/** Creates a user only if the email is free. */
const ensureUser = async ({ name, email, password, role }) => {
  const existing = await User.findOne({ email }).select('_id').lean();
  if (existing) {
    logger.info(`  = ${role.padEnd(10)} ${email} (already exists, skipped)`);
    return null;
  }

  const user = await User.create({ name, email, password, role, isActive: true });
  logger.info(`  + ${role.padEnd(10)} ${email}`);
  return user;
};

const run = async () => {
  if (shouldReset && env.isProduction) {
    logger.error('Refusing to run --reset with NODE_ENV=production.');
    process.exit(1);
  }

  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    logger.error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env before seeding.',
    );
    process.exit(1);
  }

  await connectDatabase();
  logger.info(`Seeding database: ${mongoose.connection.name}`);

  if (shouldReset) {
    const [users, sessions] = await Promise.all([
      User.deleteMany({}),
      Session.deleteMany({}),
    ]);
    logger.warn(
      `  ! reset: removed ${users.deletedCount} users and ${sessions.deletedCount} sessions`,
    );
  }

  await ensureUser({
    name: env.SEED_ADMIN_NAME,
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD,
    role: ROLES.ADMIN,
  });

  if (env.SEED_DEMO_USERS) {
    if (env.isProduction) {
      logger.warn('  ! SEED_DEMO_USERS ignored in production');
    } else if (!env.SEED_DEMO_PASSWORD) {
      logger.warn('  ! SEED_DEMO_USERS is on but SEED_DEMO_PASSWORD is not set - skipping');
    } else {
      const demo = [
        { name: 'Demo Contestant', email: 'contestant@acs.local', role: ROLES.CONTESTANT },
        { name: 'Demo Judge', email: 'judge@acs.local', role: ROLES.JUDGE },
      ];
      for (const account of demo) {
        // Sequential on purpose: the log reads in a predictable order.
        // eslint-disable-next-line no-await-in-loop
        await ensureUser({ ...account, password: env.SEED_DEMO_PASSWORD });
      }
    }
  }

  logger.info('Seed complete.');
  await disconnectDatabase();
  process.exit(0);
};

run().catch(async (error) => {
  logger.error('Seed failed:', error);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
