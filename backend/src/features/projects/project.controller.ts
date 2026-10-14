import type { RequestHandler } from 'express';
import type { ProjectService } from './project.service.js';
import { AppError } from '../../shared/errors/app-error.js';
import { createProjectSchema, listProjectsQuerySchema } from './project.schemas.js';

export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  readonly create: RequestHandler = async (req, res) => {
    if (!req.auth) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    const input = createProjectSchema.parse(req.body);
    const result = await this.projects.createProject(req.auth.userId, input);
    // The response contains a one-time secret; shared caches must never retain it.
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ data: result });
  };

  readonly list: RequestHandler = async (req, res) => {
    if (!req.auth) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    const query = listProjectsQuerySchema.parse(req.query);
    const result = await this.projects.listProjects(req.auth.userId, query.limit);
    res.status(200).json({ data: result });
  };
}
