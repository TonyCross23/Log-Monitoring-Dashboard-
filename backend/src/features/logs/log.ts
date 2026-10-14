export const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** JSON deliberately excludes undefined, functions, class instances, and BigInt. */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface IngestLogInput {
  level: LogLevel;
  message: string;
  stackTrace?: string;
  metadata?: JsonObject;
}

export interface LogEntry {
  id: string;
  projectId: string;
  level: LogLevel;
  message: string;
  stackTrace: string | null;
  metadata: JsonObject | null;
  createdAt: Date;
}

export interface FetchLogsInput {
  userId: string;
  projectId: string;
  limit?: number;
  cursor?: string;
  level?: LogLevel;
  from?: Date;
  to?: Date;
  search?: string;
}

export interface LogPage {
  items: LogEntry[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}
