import { z } from 'zod';
import { isPostgresString } from '../../shared/validation/postgres-string.js';

export const createProjectSchema = z.strictObject({
  name: z.string().trim().min(1).max(100)
    .refine(isPostgresString, 'Name must contain valid Unicode text without NUL characters.'),
});

export const listProjectsQuerySchema = z.strictObject({
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number)
    .pipe(z.number().int().min(1).max(100)).default(100),
});
