import { z } from 'zod';

export const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

/** Bound depth and size before trusting JSON supplied by an API or a demo import. */
function isJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item || item.depth > 20 || ++nodes > 10_000) return false;
    const current = item.value;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') { if (current.includes('\0')) return false; continue; }
    if (typeof current === 'number') { if (!Number.isFinite(current)) return false; continue; }
    if (typeof current !== 'object' || seen.has(current)) return false;
    seen.add(current);
    if (!Array.isArray(current)) {
      const prototype: unknown = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return false;
    }
    for (const child of Object.values(current)) pending.push({ value: child, depth: item.depth + 1 });
  }
  return new TextEncoder().encode(JSON.stringify(value)).length <= 65_536;
}

export const metadataSchema = z.custom<JsonObject>(isJsonObject, 'Metadata must be a finite JSON object.');
const timestampSchema = z.iso.datetime({ offset: true });
const validText = (value: string) => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const passwordSchema = (min: number) => z.string().min(min).max(72).refine(
  (value) => new TextEncoder().encode(value).length <= 72,
  'Password must contain at most 72 UTF-8 bytes.',
);

export const loginSchema = z.strictObject({ email: emailSchema, password: passwordSchema(1) });
export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).refine(validText, 'Use valid Unicode text.'),
  email: emailSchema,
  password: passwordSchema(12),
});
export const createProjectSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).refine(validText, 'Use valid Unicode text.'),
});
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const publicUserSchema = z.object({
  id: z.uuid(), email: z.email(), name: z.string().min(1), createdAt: timestampSchema,
});
export const authSessionSchema = z.object({
  user: publicUserSchema, accessToken: z.string().min(1), tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});
export const projectSchema = z.object({
  id: z.uuid(), name: z.string().min(1), apiKeyPrefix: z.string().min(1),
  createdAt: timestampSchema, updatedAt: timestampSchema,
});
export const createdProjectSchema = z.object({
  project: projectSchema, apiKey: z.string().regex(/^lmd_[A-Za-z0-9_-]{43}$/),
});
export const logEntrySchema = z.object({
  id: z.uuid(), projectId: z.uuid(), level: z.enum(LOG_LEVELS), message: z.string(),
  stackTrace: z.string().nullable(), metadata: metadataSchema.nullable(), createdAt: timestampSchema,
});
export const logPageSchema = z.object({
  items: z.array(logEntrySchema),
  pagination: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean(), limit: z.number().int().min(1).max(100) }),
});
export const logFiltersSchema = z.strictObject({
  level: z.enum([...LOG_LEVELS, 'ALL']).optional(),
  search: z.string().trim().max(200).refine(validText, 'Use valid Unicode text.').optional(),
  from: timestampSchema.optional(), to: timestampSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
  message: 'The end time must be on or after the start time.', path: ['to'],
});
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CreatedProject = z.infer<typeof createdProjectSchema>;
export type LogEntry = z.infer<typeof logEntrySchema>;
export type LogPage = z.infer<typeof logPageSchema>;
export type LogFilters = z.infer<typeof logFiltersSchema>;
