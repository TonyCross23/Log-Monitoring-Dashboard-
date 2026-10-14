import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { AppConfig } from '../../config/config.types.js';

export function createPrisma(config: AppConfig): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  });
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 5_000, timeout: 10_000 } });
}
