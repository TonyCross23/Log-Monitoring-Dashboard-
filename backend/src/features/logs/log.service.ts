import { AppError } from '../../shared/errors/app-error.js';
import type { FetchLogsInput, IngestLogInput, LogEntry, LogPage } from './log.js';
import type { LogCursor, LogQuery, LogRepository } from './log.repository.js';
import type { ProjectRepository } from '../projects/project.repository.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(projectId: string, entry: LogEntry): string {
  return Buffer.from(JSON.stringify({ v: 1, p: projectId, t: entry.createdAt.toISOString(), i: entry.id }))
    .toString('base64url');
}

function decodeCursor(encoded: string, projectId: string): LogCursor {
  const invalid = (): AppError => new AppError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid.');
  if (encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw invalid();
  try {
    const text = Buffer.from(encoded, 'base64url').toString('utf8');
    // Reject malformed or noncanonical encodings instead of accepting Buffer's lenient decoding.
    if (Buffer.from(text).toString('base64url') !== encoded) throw invalid();
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const cursor = value as Record<string, unknown>;
    if (cursor['v'] !== 1 || cursor['p'] !== projectId || typeof cursor['t'] !== 'string'
      || typeof cursor['i'] !== 'string' || !UUID_PATTERN.test(cursor['i'])) throw invalid();
    const createdAt = new Date(cursor['t']);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== cursor['t']) throw invalid();
    return { createdAt, id: cursor['i'] };
  } catch {
    throw invalid();
  }
}

export class LogService {
  constructor(
    private readonly logs: LogRepository,
    private readonly projects: ProjectRepository,
  ) {}

  async ingest(projectId: string, input: IngestLogInput): Promise<LogEntry> {
    return this.logs.create(projectId, input);
  }

  async fetch(input: FetchLogsInput): Promise<LogPage> {
    // Scoping the lookup by owner avoids disclosing whether another user's project exists.
    const project = await this.projects.findOwnedById(input.projectId, input.userId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AppError(400, 'INVALID_LIMIT', 'Limit must be an integer between 1 and 100.');
    }
    if ((input.from && !Number.isFinite(input.from.getTime()))
      || (input.to && !Number.isFinite(input.to.getTime()))
      || (input.from && input.to && input.from > input.to)) {
      throw new AppError(400, 'INVALID_DATE_RANGE', 'The log date range is invalid.');
    }
    const query: LogQuery = { projectId: input.projectId, take: limit + 1 };
    if (input.cursor !== undefined) query.cursor = decodeCursor(input.cursor, input.projectId);
    if (input.level !== undefined) query.level = input.level;
    if (input.from !== undefined) query.from = input.from;
    if (input.to !== undefined) query.to = input.to;
    if (input.search !== undefined) query.search = input.search;

    const records = await this.logs.findMany(query);
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      pagination: {
        nextCursor: hasMore && last ? encodeCursor(input.projectId, last) : null,
        hasMore,
        limit,
      },
    };
  }
}
