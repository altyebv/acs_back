/**
 * User routes - mounted at {API_PREFIX}/users.
 *
 * Account creation lives here, behind an admin guard, because the ACS platform
 * has no public sign-up: admins provision contestants and judges.
 *
 *   POST   /                 admin
 *   GET    /                 admin
 *   GET    /:id              admin or self
 *   PATCH  /:id              admin
 *   PATCH  /:id/status       admin
 *   PATCH  /:id/password     admin
 *   DELETE /:id              admin
 */
import { Router } from 'express';
import * as userController from './user.controller.js';
import {
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateStatusSchema,
  updateUserSchema,
} from './user.validation.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { adminOnly, authorizeSelfOrAdmin } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// Every route below needs a logged-in caller; role checks are per-route.
router.use(authenticate);

router
  .route('/')
  .post(adminOnly, validate({ body: createUserSchema }), asyncHandler(userController.createUser))
  .get(adminOnly, validate({ query: listUsersQuerySchema }), asyncHandler(userController.listUsers));

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  authorizeSelfOrAdmin('id'),
  asyncHandler(userController.getUser),
);

router.patch(
  '/:id',
  adminOnly,
  validate({ params: idParamSchema, body: updateUserSchema }),
  asyncHandler(userController.updateUser),
);

router.patch(
  '/:id/status',
  adminOnly,
  validate({ params: idParamSchema, body: updateStatusSchema }),
  asyncHandler(userController.updateStatus),
);

router.patch(
  '/:id/password',
  adminOnly,
  validate({ params: idParamSchema, body: resetPasswordSchema }),
  asyncHandler(userController.resetPassword),
);

router.delete(
  '/:id',
  adminOnly,
  validate({ params: idParamSchema }),
  asyncHandler(userController.deleteUser),
);

export default router;
