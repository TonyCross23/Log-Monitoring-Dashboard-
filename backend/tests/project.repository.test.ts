import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaProjectRepository } from '../src/features/projects/repositories/prisma-project.repository.js';

describe('PrismaProjectRepository', () => {
  it('checks project ID and owner ID in the same query', async () => {
    const findFirst = vi.fn(async (_arguments: unknown) => null);
    const prisma = { project: { findFirst } } as unknown as PrismaClient;
    await new PrismaProjectRepository(prisma).findOwnedById('project', 'owner');
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'project', ownerId: 'owner' }, select: { id: true } });
  });

  it('selects only public fields from a bounded owner-scoped listing', async () => {
    const findMany = vi.fn(async (_arguments: unknown) => []);
    const prisma = { project: { findMany } } as unknown as PrismaClient;
    await new PrismaProjectRepository(prisma).listOwned('owner', 10);
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner' },
      select: { id: true, name: true, apiKeyPrefix: true, createdAt: true, updatedAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
    });
  });
});
