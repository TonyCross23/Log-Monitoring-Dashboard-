import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaLogRepository } from '../src/features/logs/repositories/prisma-log.repository.js';

describe('PrismaLogRepository query composition', () => {
  it('combines authorization scope, filters, and keyset bounds without replacing date filters', async () => {
    const findMany = vi.fn(async (_arguments: unknown) => []);
    // The adapter uses only this delegate. Production receives the full generated client.
    const prisma = { log: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaLogRepository(prisma);
    const from = new Date('2026-10-13T00:00:00Z');
    const to = new Date('2026-10-15T00:00:00Z');
    const createdAt = new Date('2026-10-14T00:00:00Z');
    const id = 'eeeeeeee-eeee-4eee-beee-eeeeeeeeeeee';
    await repository.findMany({
      projectId: 'project', take: 51, from, to, level: 'ERROR', search: 'timeout', cursor: { createdAt, id },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project',
        level: 'ERROR',
        createdAt: { gte: from, lte: to },
        message: { contains: 'timeout', mode: 'insensitive' },
        AND: [{ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
  });

  it('escapes search metacharacters so percent, underscore, and backslash remain literal', async () => {
    const findMany = vi.fn(async (_arguments: unknown) => []);
    const prisma = { log: { findMany } } as unknown as PrismaClient;
    await new PrismaLogRepository(prisma).findMany({ projectId: 'project', take: 51, search: '100%_done\\x' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project', message: { contains: '100\\%\\_done\\\\x', mode: 'insensitive' } },
    }));
  });
});
