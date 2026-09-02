/**
 * Auth routes - mounted at {API_PREFIX}/auth.
 *
 *   POST   /login          public
 *   POST   /refresh        public (needs the refresh cookie)
 *   POST   /logout         public (idempotent)
 *   POST   /logout-all     authenticated
 *   GET    /me             authenticated
 *   GET    /sessions       authenticated
 *   PATCH  /password       authenticated
 */
import { Router } from 'express';
import * as authController from './auth.controller.js';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
} from './auth.validation.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { loginLimiter } from '../../middleware/rateLimiters.js';

const router = Router();

router.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

router.post(
  '/refresh',
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh),
);

router.post('/logout', asyncHandler(authController.logout));

// --- everything below requires a valid access token ---
router.use(authenticate);

router.get('/me', asyncHandler(authController.me));
router.get('/sessions', asyncHandler(authController.sessions));
router.post('/logout-all', asyncHandler(authController.logoutAll));
router.patch(
  '/password',
  validate({ body: changePasswordSchema }),
  asyncHandler(authController.changePassword),
);

export default router;
