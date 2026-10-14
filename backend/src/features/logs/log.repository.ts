import type { IngestLogInput, LogEntry, LogLevel } from './log.js';

export interface LogCursor {
  createdAt: Date;
  id: string;
}

export interface LogQuery {
  projectId: string;
  /** Includes the additional look-ahead row used by keyset pagination. */
  take: number;
  cursor?: LogCursor;
  level?: LogLevel;
  from?: Date;
  to?: Date;
  search?: string;
}

export interface LogRepository {
  create(projectId: string, input: IngestLogInput): Promise<LogEntry>;
  findMany(query: LogQuery): Promise<LogEntry[]>;
}
