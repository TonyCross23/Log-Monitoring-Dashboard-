import type { RequestHandler } from 'express';
import type { ProjectService } from '../project.service.js';
import { AppError } from '../../../shared/errors/app-error.js';

export function createApiKeyMiddleware(projects: ProjectService): RequestHandler {
  return async (req, _res, next) => {
    // Duplicate keys are joined by Node's HTTP parser; the service rejects the resulting format.
    const apiKey = req.get('x-api-key');
    if (!apiKey) throw new AppError(401, 'INVALID_API_KEY', 'A valid project API key is required.');
    req.project = await projects.authenticateApiKey(apiKey);
    next();
  };
}
