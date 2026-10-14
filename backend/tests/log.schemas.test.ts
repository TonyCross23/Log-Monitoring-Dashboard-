import { describe, expect, it } from 'vitest';
import { fetchLogsQuerySchema, logIngestionSchema } from '../src/features/logs/log.schemas.js';

describe('log request validation', () => {
  it('accepts finite nested metadata and all supported log levels', () => {
    for (const level of ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
      expect(logIngestionSchema.parse({
        level,
        message: 'A useful event',
        metadata: { requestId: 'r1', nested: { flags: [true, false, null], duration: 4.2 } },
      }).level).toBe(level);
    }
  });

  it('rejects unknown fields, invalid levels, and non-object metadata', () => {
    for (const metadata of [null, [], 'text', 123]) {
      expect(logIngestionSchema.safeParse({ level: 'INFO', message: 'event', metadata }).success).toBe(false);
    }
    expect(logIngestionSchema.safeParse({ level: 'info', message: 'event' }).success).toBe(false);
    expect(logIngestionSchema.safeParse({ level: 'INFO', message: 'event', projectId: 'override' }).success).toBe(false);
  });

  it('rejects non-finite, undefined, cyclic, and excessively deep metadata safely', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    let deep: Record<string, unknown> = { value: true };
    for (let i = 0; i < 21; i += 1) deep = { child: deep };
    for (const metadata of [{ number: Infinity }, { number: NaN }, { value: undefined }, cycle, deep]) {
      expect(logIngestionSchema.safeParse({ level: 'INFO', message: 'event', metadata }).success).toBe(false);
    }
  });

  it('bounds serialized UTF-8 bytes and metadata node count', () => {
    expect(logIngestionSchema.safeParse({ level: 'INFO', message: '😀'.repeat(4_097) }).success).toBe(false);
    expect(logIngestionSchema.safeParse({ level: 'INFO', message: 'event', metadata: { data: '😀'.repeat(16_384) } }).success).toBe(false);
    expect(logIngestionSchema.safeParse({ level: 'INFO', message: 'event', metadata: { data: Array.from({ length: 10_001 }, () => null) } }).success).toBe(false);
  });

  it('rejects PostgreSQL-invalid text in messages, stack traces, metadata keys, and metadata values', () => {
    for (const invalid of ['text\u0000', '\ud800', '\udc00']) {
      expect(logIngestionSchema.safeParse({ level: 'INFO', message: invalid }).success).toBe(false);
      expect(logIngestionSchema.safeParse({ level: 'INFO', message: 'event', stackTrace: invalid }).success).toBe(false);
      expect(logIngestionSchema.safeParse({ level: 'INFO', message: 'event', metadata: { value: invalid } }).success).toBe(false);
      expect(logIngestionSchema.safeParse({ level: 'INFO', message: 'event', metadata: { [invalid]: true } }).success).toBe(false);
      expect(fetchLogsQuerySchema.safeParse({ search: invalid }).success).toBe(false);
    }
    expect(logIngestionSchema.safeParse({ level: 'INFO', message: '😀', metadata: { '😀': '😀' } }).success).toBe(true);
  });

  it('uses bounded pagination and timezone-aware timestamp filters', () => {
    expect(fetchLogsQuerySchema.parse({})).toEqual({ limit: 50 });
    const query = fetchLogsQuerySchema.parse({
      limit: '100', level: 'ERROR', search: '  outage  ',
      from: '2026-10-14T12:00:00+06:30', to: '2026-10-14T12:30:00+06:30',
    });
    expect(query.limit).toBe(100);
    expect(query.search).toBe('outage');
    expect(query.from?.toISOString()).toBe('2026-10-14T05:30:00.000Z');
    for (const limit of ['0', '101', '-1', '1.5', '', ['10', '20']]) {
      expect(fetchLogsQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(fetchLogsQuerySchema.safeParse({ from: '2026-10-14T12:00:00' }).success).toBe(false);
    expect(fetchLogsQuerySchema.safeParse({ from: '2026-10-15T00:00:00Z', to: '2026-10-14T00:00:00Z' }).success).toBe(false);
  });
});
