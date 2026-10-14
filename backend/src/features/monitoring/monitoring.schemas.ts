import { z } from 'zod';

export const emptyMonitorInputSchema = z.strictObject({});
export const monitorQuerySchema = z.strictObject({
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number)
    .pipe(z.number().int().min(1).max(100)).default(60),
});
