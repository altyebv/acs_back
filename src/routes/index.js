/**
 * API v1 router - the one place modules are mounted.
 *
 * ADDING A MODULE (for the rest of the team):
 *   1. Create src/modules/<name>/ with <name>.routes.js, .controller.js,
 *      .service.js and .validation.js.
 *   2. Protect the routes inside that file with `authenticate` and
 *      `authorize(...)` - see src/modules/users/user.routes.js for the pattern.
 *   3. Import it here and add one `router.use(...)` line below.
 * Nothing else in the foundation needs to change.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import { sendSuccess } from '../utils/apiResponse.js';

const router = Router();

/** Liveness + database readiness. Unauthenticated on purpose. */
router.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return sendSuccess(res, {
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    database: states[mongoose.connection.readyState] ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);

// Next up:
// router.use('/submissions', submissionRoutes);
// router.use('/files', fileRoutes);

export default router;
