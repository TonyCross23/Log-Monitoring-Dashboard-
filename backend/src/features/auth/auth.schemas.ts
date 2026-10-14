import { z } from 'zod';
import { isPostgresString } from '../../shared/validation/postgres-string.js';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

function passwordSchema(minLength: number): z.ZodString {
  return z
    .string()
    .min(minLength)
    .max(72)
    .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, {
      message: 'Password must contain at most 72 UTF-8 bytes.',
    });
}

// bcrypt truncates after 72 bytes, so reject overlong Unicode input before hashing.
export const registerSchema = z.strictObject({
  email: emailSchema,
  name: z.string().trim().min(1).max(100)
    .refine(isPostgresString, 'Name must contain valid Unicode text without NUL characters.'),
  password: passwordSchema(12),
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema(1),
});

export const emptyInputSchema = z.strictObject({});
export const emptyBodySchema = z.union([emptyInputSchema, z.undefined()]);
