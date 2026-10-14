import { describe, expect, it } from 'vitest';
import { createDemoProject, DEMO_PROJECT_IDS, fetchDemoLogs, listDemoProjects } from '../src/lib/demo-data';
import { createdProjectSchema, logPageSchema, metadataSchema, registerSchema } from '../src/lib/models';

describe('API models and form validation', () => {
  it('matches the server bcrypt limit in bytes for Unicode passwords', () => {
    expect(registerSchema.safeParse({ name: 'Maya', email: 'maya@example.com', password: 'é'.repeat(37) }).success).toBe(false);
    expect(registerSchema.parse({ name: ' Maya ', email: 'MAYA@EXAMPLE.COM', password: 'é'.repeat(36) }).email).toBe('maya@example.com');
  });

  it('rejects non-JSON, cyclic, deeply nested, and oversized metadata', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(metadataSchema.safeParse(cyclic).success).toBe(false);
    expect(metadataSchema.safeParse({ value: Number.NaN }).success).toBe(false);
    expect(metadataSchema.safeParse([]).success).toBe(false);
    expect(metadataSchema.safeParse({ message: 'x'.repeat(65_536) }).success).toBe(false);
    let nested: Record<string, unknown> = { value: 'safe' };
    for (let index = 0; index < 22; index++) nested = { child: nested };
    expect(metadataSchema.safeParse(nested).success).toBe(false);
    expect(metadataSchema.safeParse({ context: { tags: ['checkout', 12, null], success: true } }).success).toBe(true);
  });

  it('rejects invalid server IDs, levels, and timestamps', () => {
    const page = fetchDemoLogs(DEMO_PROJECT_IDS.payments);
    const first = page.items[0];
    if (!first) throw new Error('Missing demo log.');
    expect(logPageSchema.safeParse({ ...page, items: [{ ...first, level: 'unknown' }] }).success).toBe(false);
    expect(logPageSchema.safeParse({ ...page, items: [{ ...first, projectId: 'not-a-uuid' }] }).success).toBe(false);
    expect(logPageSchema.safeParse({ ...page, items: [{ ...first, createdAt: 'yesterday' }] }).success).toBe(false);
  });
});

describe('demo projects and cursor pagination', () => {
  it('uses API-compatible records and keeps project data isolated', () => {
    for (const project of listDemoProjects()) {
      const page = fetchDemoLogs(project.id);
      expect(logPageSchema.safeParse(page).success).toBe(true);
      expect(page.items.every((log) => log.projectId === project.id)).toBe(true);
    }
  });

  it('combines level, substring, and date filters', () => {
    const page = fetchDemoLogs(DEMO_PROJECT_IDS.payments, { level: 'ERROR', search: 'TIMEOUT' });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((log) => log.level === 'ERROR' && log.message.toLowerCase().includes('timeout'))).toBe(true);
    const first = page.items[0];
    if (!first) throw new Error('Missing matching demo log.');
    const exact = fetchDemoLogs(DEMO_PROJECT_IDS.payments, { from: first.createdAt, to: first.createdAt });
    expect(exact.items.map((log) => log.id)).toEqual([first.id]);
  });

  it('paginates in stable descending order without duplicates', () => {
    const ids = new Set<string>();
    let cursor: string | undefined;
    let lastTimestamp = Number.POSITIVE_INFINITY;
    let count = 0;
    do {
      const page = fetchDemoLogs(DEMO_PROJECT_IDS.payments, { limit: 13 }, cursor);
      for (const log of page.items) {
        expect(ids.has(log.id)).toBe(false);
        expect(Date.parse(log.createdAt)).toBeLessThanOrEqual(lastTimestamp);
        ids.add(log.id);
        lastTimestamp = Date.parse(log.createdAt);
        count++;
      }
      cursor = page.pagination.nextCursor ?? undefined;
    } while (cursor);
    expect(count).toBe(154);
  });

  it('returns a one-time illustrative key without storing the key on project records', () => {
    const created = createDemoProject({ name: ' demo-test ' });
    expect(createdProjectSchema.safeParse(created).success).toBe(true);
    expect(created.project.name).toBe('demo-test');
    expect(listDemoProjects().find((project) => project.id === created.project.id)).not.toHaveProperty('apiKey');
    expect(fetchDemoLogs(created.project.id).items).toEqual([]);
  });
});
