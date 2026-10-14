import { loadConfig } from './config/env.js';
import { createRuntime } from './composition-root.js';
import { startMonitoring } from './features/monitoring/monitoring.scheduler.js';

const config = loadConfig();
const { app, prisma, logger, monitoringService } = createRuntime(config);

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
} catch (error: unknown) {
  logger.fatal({ err: error }, 'Database startup failed');
  await prisma.$disconnect();
  process.exit(1);
}

const server = app.listen(config.port, () => { logger.info({ port: config.port }, 'Server listening'); });
const stopMonitoring = startMonitoring(monitoringService, logger);
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

let shuttingDown = false;
function shutdown(reason: string, exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stopMonitoring();
  logger.info({ reason }, 'Shutting down');
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  deadline.unref();
  server.close(() => {
    void prisma.$disconnect().then(() => {
      clearTimeout(deadline);
      process.exit(exitCode);
    }).catch((error: unknown) => {
      logger.error({ err: error }, 'Database shutdown failed');
      process.exit(1);
    });
  });
}

process.on('SIGTERM', () => { shutdown('SIGTERM', 0); });
process.on('SIGINT', () => { shutdown('SIGINT', 0); });
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ err: reason }, 'Unhandled rejection'); shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error: Error) => {
  logger.fatal({ err: error }, 'Uncaught exception'); shutdown('uncaughtException', 1);
});
server.on('error', (error: Error) => { logger.fatal({ err: error }, 'Server failure'); shutdown('serverError', 1); });
