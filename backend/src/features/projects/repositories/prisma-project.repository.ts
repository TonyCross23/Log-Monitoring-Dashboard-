import type { Project } from '../project.js';
import type { NewProject, ProjectRepository } from '../project.repository.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';

const publicProjectSelect = {
  id: true,
  name: true,
  apiKeyPrefix: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: NewProject): Promise<Project> {
    return this.prisma.project.create({ data: input, select: publicProjectSelect });
  }

  async listOwned(ownerId: string, limit: number): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { ownerId },
      select: publicProjectSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async findOwnedById(projectId: string, ownerId: string): Promise<{ id: string } | null> {
    return this.prisma.project.findFirst({ where: { id: projectId, ownerId }, select: { id: true } });
  }

  async findByApiKeyHash(apiKeyHash: string): Promise<{ id: string } | null> {
    return this.prisma.project.findUnique({ where: { apiKeyHash }, select: { id: true } });
  }
}
