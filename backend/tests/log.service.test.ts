import { describe, expect, it, vi } from 'vitest';
import { LogService } from '../src/features/logs/log.service.js';
import type { IngestLogInput, LogEntry } from '../src/features/logs/log.js';
import type { LogQuery, LogRepository } from '../src/features/logs/log.repository.js';
import type { NewProject, ProjectRepository } from '../src/features/projects/project.repository.js';

const projectId = '3b4604e6-34e7-47df-82ba-bd038bd2e7c1';
const otherProjectId = '485ca4ef-a15e-4f1e-9ac9-d1c2fb6bdd50';
const timestamp = new Date('2026-10-14T00:00:00.000Z');
function entry(id: string): LogEntry {
  return { id, projectId, level: 'INFO', message: 'event', stackTrace: null, metadata: null, createdAt: timestamp };
}
const first = entry('ffffffff-ffff-4fff-bfff-ffffffffffff');
const second = entry('eeeeeeee-eeee-4eee-beee-eeeeeeeeeeee');
const third = entry('dddddddd-dddd-4ddd-bddd-dddddddddddd');

function fixtures() {
  const logs = {
    create: vi.fn(async (_projectId: string, _input: IngestLogInput) => first),
    findMany: vi.fn(async (_query: LogQuery) => [first, second, third]),
  } satisfies LogRepository;
  const projects = {
    create: vi.fn(async (_input: NewProject) => ({ id: projectId, name: 'API', apiKeyPrefix: 'lmd_test', createdAt: timestamp, updatedAt: timestamp })),
    listOwned: vi.fn(async (_ownerId: string, _limit: number) => []),
    findOwnedById: vi.fn(async (_projectId: string, _ownerId: string): Promise<{ id: string } | null> => ({ id: projectId })),
    findByApiKeyHash: vi.fn(async (_hash: string) => ({ id: projectId })),
  } satisfies ProjectRepository;
  return { logs, projects, service: new LogService(logs, projects) };
}

describe('LogService', () => {
  it('enforces project ownership before accessing logs', async () => {
    const { service, projects, logs } = fixtures();
    projects.findOwnedById.mockResolvedValueOnce(null);
    await expect(service.fetch({ userId: 'other-owner', projectId })).rejects.toMatchObject({ statusCode: 404 });
    expect(projects.findOwnedById).toHaveBeenCalledWith(projectId, 'other-owner');
    expect(logs.findMany).not.toHaveBeenCalled();
  });

  it('passes filters together and uses one look-ahead row', async () => {
    const { service, logs } = fixtures();
    const from = new Date('2026-10-13T00:00:00Z');
    const to = new Date('2026-10-15T00:00:00Z');
    const page = await service.fetch({ userId: 'owner', projectId, limit: 2, level: 'ERROR', from, to, search: 'outage' });
    expect(logs.findMany).toHaveBeenCalledWith({ projectId, take: 3, level: 'ERROR', from, to, search: 'outage' });
    expect(page.items).toEqual([first, second]);
    expect(page.pagination).toMatchObject({ hasMore: true, limit: 2 });
    expect(page.pagination.nextCursor).toBeTypeOf('string');
  });

  it('round-trips both timestamp and ID through a project-scoped cursor', async () => {
    const { service, logs } = fixtures();
    const page = await service.fetch({ userId: 'owner', projectId, limit: 2 });
    const cursor = page.pagination.nextCursor;
    if (!cursor) throw new Error('Expected a continuation cursor.');
    logs.findMany.mockResolvedValueOnce([third]);
    const finalPage = await service.fetch({ userId: 'owner', projectId, limit: 2, cursor });
    expect(logs.findMany).toHaveBeenLastCalledWith({ projectId, take: 3, cursor: { id: second.id, createdAt: timestamp } });
    expect(finalPage.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 2 });
    await expect(service.fetch({ userId: 'owner', projectId: otherProjectId, cursor })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('rejects malformed cursors and invalid limits before log access', async () => {
    const { service, logs } = fixtures();
    for (const cursor of ['?', 'a'.repeat(513), Buffer.from('{}').toString('base64url')]) {
      await expect(service.fetch({ userId: 'owner', projectId, cursor })).rejects.toMatchObject({ statusCode: 400 });
    }
    for (const limit of [0, 101, 1.5]) {
      await expect(service.fetch({ userId: 'owner', projectId, limit })).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(logs.findMany).not.toHaveBeenCalled();
  });
});
