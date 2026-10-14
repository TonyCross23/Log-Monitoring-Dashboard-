import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error.js';
import type { CreatedProject, CreateProjectInput, Project } from './project.js';
import type { ProjectRepository } from './project.repository.js';

export const API_KEY_PATTERN = /^lmd_[A-Za-z0-9_-]{43}$/;

export function hashApiKey(apiKey: string): string {
  // High-entropy random keys need a fast cryptographic digest, not password hashing.
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

export class ProjectService {
  constructor(private readonly projects: ProjectRepository) {}

  async createProject(ownerId: string, input: CreateProjectInput): Promise<CreatedProject> {
    const apiKey = `lmd_${randomBytes(32).toString('base64url')}`;
    const project = await this.projects.create({
      ownerId,
      name: input.name,
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPrefix: apiKey.slice(0, 12),
    });
    return { project, apiKey };
  }

  async listProjects(ownerId: string, limit = 100): Promise<Project[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AppError(400, 'INVALID_LIMIT', 'Limit must be an integer between 1 and 100.');
    }
    return this.projects.listOwned(ownerId, limit);
  }

  async authenticateApiKey(apiKey: string): Promise<{ id: string }> {
    if (!API_KEY_PATTERN.test(apiKey)) {
      throw new AppError(401, 'INVALID_API_KEY', 'A valid project API key is required.');
    }
    const project = await this.projects.findByApiKeyHash(hashApiKey(apiKey));
    if (!project) {
      throw new AppError(401, 'INVALID_API_KEY', 'A valid project API key is required.');
    }
    return project;
  }
}
