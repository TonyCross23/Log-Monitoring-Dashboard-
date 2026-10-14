import { z } from 'zod';
import { LOG_LEVELS, type JsonObject } from './log.js';
import { isPostgresString } from '../../shared/validation/postgres-string.js';

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_STACK_TRACE_BYTES = 64 * 1024;
export const MAX_METADATA_BYTES = 64 * 1024;
export const MAX_METADATA_DEPTH = 20;
export const MAX_METADATA_NODES = 10_000;

/** Iterative validation avoids stack overflows on deeply nested or cyclic input. */
function isFiniteJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodeCount = 1;
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item || item.depth > MAX_METADATA_DEPTH) return false;
    const current = item.value;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') {
      if (!isPostgresString(current)) return false;
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current !== 'object' || seen.has(current)) return false;
    seen.add(current);
    if (!Array.isArray(current)) {
      const prototype: unknown = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return false;
      for (const key of Object.keys(current)) {
        if (!isPostgresString(key)) return false;
      }
    }
    for (const child of Object.values(current)) {
      nodeCount += 1;
      if (nodeCount > MAX_METADATA_NODES) return false;
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return true;
}

export const metadataSchema = z.custom<JsonObject>(isFiniteJsonObject, {
  message: `Metadata must be a finite JSON object with at most ${MAX_METADATA_DEPTH} levels and ${MAX_METADATA_NODES} nodes.`,
}).superRefine((value, ctx) => {
  // Guard serialization even when a non-HTTP caller supplies invalid values.
  if (!isFiniteJsonObject(value)) return;
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_METADATA_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'Serialized metadata must not exceed 64 KiB.' });
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Metadata must be JSON serializable.' });
  }
});

export const logIngestionSchema = z.strictObject({
  level: z.enum(LOG_LEVELS),
  message: z.string().min(1).max(MAX_MESSAGE_BYTES)
    .refine((value) => value.trim().length > 0, 'Message must not be blank.')
    .refine(isPostgresString, 'Message must contain valid Unicode text without NUL characters.')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_MESSAGE_BYTES,
      'Message must not exceed 16 KiB.'),
  stackTrace: z.string().max(MAX_STACK_TRACE_BYTES)
    .refine(isPostgresString, 'Stack trace must contain valid Unicode text without NUL characters.')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_STACK_TRACE_BYTES,
      'Stack trace must not exceed 64 KiB.').optional(),
  metadata: metadataSchema.optional(),
});

export const projectLogsParamsSchema = z.strictObject({
  projectId: z.uuid(),
});

const timestampSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const fetchLogsQuerySchema = z.strictObject({
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number)
    .pipe(z.number().int().min(1).max(100)).default(50),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  level: z.enum(LOG_LEVELS).optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  search: z.string().trim().min(1).max(200)
    .refine(isPostgresString, 'Search must contain valid Unicode text without NUL characters.').optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end time must be on or after the start time.' });
  }
});
