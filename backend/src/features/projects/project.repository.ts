import type { Project } from './project.js';

export interface NewProject {
  ownerId: string;
  name: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
}

export interface ProjectRepository {
  create(input: NewProject): Promise<Project>;
  listOwned(ownerId: string, limit: number): Promise<Project[]>;
  findOwnedById(projectId: string, ownerId: string): Promise<{ id: string } | null>;
  findByApiKeyHash(hash: string): Promise<{ id: string } | null>;
}
