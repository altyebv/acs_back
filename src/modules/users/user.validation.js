/**
 * User management schemas (admin surface).
 */
import { z } from 'zod';
import { ASSIGNABLE_ROLES, ROLE_VALUES } from '../../constants/roles.js';
import { emailSchema, strongPasswordSchema } from '../auth/auth.validation.js';

export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id format');

export const idParamSchema = z.object({ id: objectIdSchema });

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
    email: emailSchema,
    password: strongPasswordSchema,
    role: z.enum(ASSIGNABLE_ROLES, {
      errorMap: () => ({ message: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` }),
    }),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

/** Password is not editable here - use the reset endpoint, which is explicit. */
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: emailSchema.optional(),
    role: z.enum(ASSIGNABLE_ROLES).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const updateStatusSchema = z
  .object({ isActive: z.boolean({ required_error: 'isActive is required' }) })
  .strict();

export const resetPasswordSchema = z
  .object({ newPassword: strongPasswordSchema })
  .strict();

export const listUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    role: z.enum(ROLE_VALUES).optional(),
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['createdAt', '-createdAt', 'name', '-name']).default('-createdAt'),
  })
  .strip();
