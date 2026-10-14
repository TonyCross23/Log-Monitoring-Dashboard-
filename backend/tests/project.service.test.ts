import { describe, expect, it, vi } from 'vitest';
import { hashApiKey, ProjectService } from '../src/features/projects/project.service.js';
import type { NewProject, ProjectRepository } from '../src/features/projects/project.repository.js';
import type { Project } from '../src/features/projects/project.js';

const project: Project = {
  id: '3b4604e6-34e7-47df-82ba-bd038bd2e7c1', name: 'API', apiKeyPrefix: 'lmd_example',
  createdAt: new Date('2026-10-14T00:00:00Z'), updatedAt: new Date('2026-10-14T00:00:00Z'),
};

function fakeProjects() {
  return {
    create: vi.fn(async (_input: NewProject) => project),
    listOwned: vi.fn(async (_ownerId: string, _limit: number) => [project]),
    findOwnedById: vi.fn(async (_projectId: string, _ownerId: string) => ({ id: project.id })),
    findByApiKeyHash: vi.fn(async (_hash: string): Promise<{ id: string } | null> => ({ id: project.id })),
  } satisfies ProjectRepository;
}

describe('ProjectService', () => {
  it('returns a fresh key once and persists only its SHA-256 digest and display prefix', async () => {
    const repository = fakeProjects();
    const service = new ProjectService(repository);
    const first = await service.createProject('owner', { name: 'API' });
    const second = await service.createProject('owner', { name: 'Worker' });
    expect(first.apiKey).toMatch(/^lmd_[A-Za-z0-9_-]{43}$/);
    expect(second.apiKey).not.toBe(first.apiKey);
    expect(repository.create).toHaveBeenCalledWith({
      ownerId: 'owner', name: 'API', apiKeyHash: hashApiKey(first.apiKey), apiKeyPrefix: first.apiKey.slice(0, 12),
    });
    expect(JSON.stringify(repository.create.mock.calls)).not.toContain(first.apiKey);
  });

  it('authenticates using a digest lookup and rejects missing or malformed secrets before querying', async () => {
    const repository = fakeProjects();
    const service = new ProjectService(repository);
    const key = `lmd_${'a'.repeat(43)}`;
    await expect(service.authenticateApiKey(key)).resolves.toEqual({ id: project.id });
    expect(repository.findByApiKeyHash).toHaveBeenCalledWith(hashApiKey(key));
    repository.findByApiKeyHash.mockClear();
    for (const invalid of ['', 'wrong', `${key}, ${key}`, `${key} `]) {
      await expect(service.authenticateApiKey(invalid)).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_API_KEY' });
    }
    expect(repository.findByApiKeyHash).not.toHaveBeenCalled();
    repository.findByApiKeyHash.mockResolvedValueOnce(null);
    await expect(service.authenticateApiKey(key)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('scopes and bounds project listing', async () => {
    const repository = fakeProjects();
    const service = new ProjectService(repository);
    await service.listProjects('owner', 10);
    expect(repository.listOwned).toHaveBeenCalledWith('owner', 10);
    await expect(service.listProjects('owner', 101)).rejects.toMatchObject({ statusCode: 400 });
  });
});
