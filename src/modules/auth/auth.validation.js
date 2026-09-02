/**
 * Auth request schemas.
 *
 * Validation lives beside the routes it guards so the accepted shape of an
 * endpoint is one file away from its handler.
 */
import { z } from 'zod';

export const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Email format is invalid')
  .max(254);

/**
 * Password policy for NEW passwords.
 * Login deliberately does NOT apply it - an old account whose password predates
 * the policy must still be able to log in and change it.
 */
export const strongPasswordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number');

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
  })
  .strict();

export const refreshSchema = z
  .object({
    // Optional: browsers send the cookie, other clients may post the token.
    refreshToken: z.string().min(1).optional(),
  })
  .strip();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: strongPasswordSchema,
  })
  .strict();
