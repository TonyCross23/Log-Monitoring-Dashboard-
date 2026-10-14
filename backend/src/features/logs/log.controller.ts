import type { RequestHandler } from 'express';
import type { LogService } from './log.service.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { FetchLogsInput, IngestLogInput } from './log.js';
import { fetchLogsQuerySchema, logIngestionSchema, projectLogsParamsSchema } from './log.schemas.js';

export class LogController {
  constructor(private readonly logs: LogService) {}

  readonly ingest: RequestHandler = async (req, res) => {
    if (!req.project) throw new AppError(401, 'INVALID_API_KEY', 'A valid project API key is required.');
    const parsed = logIngestionSchema.parse(req.body);
    const input: IngestLogInput = { level: parsed.level, message: parsed.message };
    if (parsed.stackTrace !== undefined) input.stackTrace = parsed.stackTrace;
    if (parsed.metadata !== undefined) input.metadata = parsed.metadata;
    const result = await this.logs.ingest(req.project.id, input);
    res.status(201).json({ data: result });
  };

  readonly fetch: RequestHandler = async (req, res) => {
    if (!req.auth) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    const params = projectLogsParamsSchema.parse(req.params);
    const query = fetchLogsQuerySchema.parse(req.query);
    const input: FetchLogsInput = {
      userId: req.auth.userId,
      projectId: params.projectId,
      limit: query.limit,
    };
    if (query.cursor !== undefined) input.cursor = query.cursor;
    if (query.level !== undefined) input.level = query.level;
    if (query.from !== undefined) input.from = query.from;
    if (query.to !== undefined) input.to = query.to;
    if (query.search !== undefined) input.search = query.search;
    const result = await this.logs.fetch(input);
    res.status(200).json({ data: result });
  };
}
