import { createApp } from './app.js';
import type { AppConfig } from './config/config.types.js';
import { AuthService } from './features/auth/auth.service.js';
import { ProjectService } from './features/projects/project.service.js';
import { LogService } from './features/logs/log.service.js';
import { JwtTokenProvider } from './features/auth/security/jwt-token-provider.js';
import { BcryptPasswordHasher } from './features/auth/security/bcrypt-password-hasher.js';
import { createPrisma } from './shared/database/prisma.js';
import { createLogger } from './shared/logger.js';
import { PrismaUserRepository } from './features/auth/repositories/prisma-user.repository.js';
import { PrismaRefreshSessionRepository } from './features/auth/repositories/prisma-refresh-session.repository.js';
import { PrismaProjectRepository } from './features/projects/repositories/prisma-project.repository.js';
import { PrismaLogRepository } from './features/logs/repositories/prisma-log.repository.js';
import { AuthController } from './features/auth/auth.controller.js';
import { ProjectController } from './features/projects/project.controller.js';
import { LogController } from './features/logs/log.controller.js';
import { CeirHttpProbe } from './features/monitoring/ceir-http.probe.js';
import { PrismaMonitoringRepository } from './features/monitoring/prisma-monitoring.repository.js';
import { MonitoringService } from './features/monitoring/monitoring.service.js';
import { MonitoringController } from './features/monitoring/monitoring.controller.js';

/** The only place that chooses concrete infrastructure for the application. */
export function createRuntime(config: AppConfig) {
  const logger = createLogger(config);
  const prisma = createPrisma(config);
  const tokenProvider = new JwtTokenProvider(config);
  const projectRepository = new PrismaProjectRepository(prisma);
  const projectService = new ProjectService(projectRepository);
  const logService = new LogService(new PrismaLogRepository(prisma), projectRepository);
  const monitoringService = new MonitoringService(
    new PrismaMonitoringRepository(prisma), new CeirHttpProbe(config.ceirMonitoring),
    config.ceirMonitoring?.intervalSeconds ?? 60,
  );
  const authService = new AuthService(
    new PrismaUserRepository(prisma), new PrismaRefreshSessionRepository(prisma),
    new BcryptPasswordHasher(config.bcryptRounds), tokenProvider,
  );
  const app = createApp({
    config, logger, tokenProvider, projectService,
    authController: new AuthController(authService, config),
    projectController: new ProjectController(projectService),
    logController: new LogController(logService),
    monitoringController: new MonitoringController(monitoringService),
    isDatabaseReady: async () => {
      try { await prisma.$queryRaw`SELECT 1`; return true; }
      catch { return false; }
    },
  });
  return { app, prisma, logger, monitoringService };
}
