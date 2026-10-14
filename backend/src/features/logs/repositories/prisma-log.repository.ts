import type { IngestLogInput, JsonObject, LogEntry } from '../log.js';
import type { LogQuery, LogRepository } from '../log.repository.js';
import type { Log, Prisma, PrismaClient } from '../../../generated/prisma/client.js';

function toEntry(record: Log): LogEntry {
  let metadata: JsonObject | null = null;
  if (record.metadata !== null) {
    if (typeof record.metadata !== 'object' || Array.isArray(record.metadata)) {
      throw new Error('Stored log metadata must be a JSON object.');
    }
    // Prisma's JSON object type includes optional keys; the serialized database value has none.
    metadata = record.metadata as JsonObject;
  }
  return { ...record, metadata };
}

export class PrismaLogRepository implements LogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(projectId: string, input: IngestLogInput): Promise<LogEntry> {
    const data: Prisma.LogUncheckedCreateInput = {
      projectId,
      level: input.level,
      message: input.message,
    };
    if (input.stackTrace !== undefined) data.stackTrace = input.stackTrace;
    if (input.metadata !== undefined) data.metadata = input.metadata;
    return toEntry(await this.prisma.log.create({ data }));
  }

  async findMany(query: LogQuery): Promise<LogEntry[]> {
    const where: Prisma.LogWhereInput = { projectId: query.projectId };
    if (query.level !== undefined) where.level = query.level;
    if (query.from !== undefined || query.to !== undefined) {
      const range: Prisma.DateTimeFilter = {};
      if (query.from !== undefined) range.gte = query.from;
      if (query.to !== undefined) range.lte = query.to;
      where.createdAt = range;
    }
    if (query.search !== undefined) {
      // PostgreSQL LIKE uses these metacharacters; search should mean literal text.
      const literalSearch = query.search.replace(/[\\%_]/g, '\\$&');
      where.message = { contains: literalSearch, mode: 'insensitive' };
    }
    if (query.cursor !== undefined) {
      // Compare the timestamp and ID together; equal timestamps must not skip rows.
      where.AND = [{
        OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ],
      }];
    }
    const records = await this.prisma.log.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.take,
    });
    return records.map(toEntry);
  }
}
