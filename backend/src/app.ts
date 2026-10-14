import express from 'express';
import type { RequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { AppConfig } from './config/config.types.js';
import type { TokenProvider } from './features/auth/auth.ports.js';
import { AppError } from './shared/errors/app-error.js';
import type { ProjectService } from './features/projects/project.service.js';
import type { AuthController } from './features/auth/auth.controller.js';
import type { ProjectController } from './features/projects/project.controller.js';
import type { LogController } from './features/logs/log.controller.js';
import type { MonitoringController } from './features/monitoring/monitoring.controller.js';
import { createAuthMiddleware } from './features/auth/middleware/auth.middleware.js';
import { createApiKeyMiddleware } from './features/projects/middleware/api-key.middleware.js';
import { createCookieOriginMiddleware } from './shared/middleware/cookie-origin.middleware.js';
import { createErrorHandler, notFound } from './shared/middleware/error-handler.middleware.js';
import { requireJson } from './shared/middleware/content-type.middleware.js';
import { requestContext } from './shared/middleware/request-context.middleware.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  authController: AuthController;
  projectController: ProjectController;
  logController: LogController;
  tokenProvider: TokenProvider;
  projectService: ProjectService;
  isDatabaseReady: () => Promise<boolean>;
  monitoringController?: MonitoringController;
}

function createLimiter(windowMs: number, limit: number, keyGenerator?: (request: express.Request) => string): RequestHandler {
  return rateLimit({
    windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    ...(keyGenerator === undefined ? {} : { keyGenerator }),
    handler: (_request, _response, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests; try again later')),
  });
}

/** Composition of HTTP concerns only; business and database dependencies are injected. */
export function createApp(dependencies: AppDependencies): express.Express {
  const { config, logger, authController, projectController, logController } = dependencies;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');
  app.use(requestContext);
  app.use(pinoHttp({
    logger,
    genReqId: (request) => (request as express.Request).requestId,
    serializers: {
      // Log only the path and method: no cookies, authorization, query values, or bodies.
      req: (request: { id?: unknown; method?: unknown; url?: unknown }) => ({
        id: request.id, method: request.method,
        path: typeof request.url === 'string' ? request.url.split('?')[0] : undefined,
      }),
      res: (response: { statusCode?: unknown }) => ({ statusCode: response.statusCode }),
    },
  }));
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => {
      if (origin === undefined || config.corsOrigins.includes(origin)) callback(null, true);
      else callback(new AppError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-CSRF-Protection'],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
    maxAge: 600,
  }));
  app.use(createLimiter(60_000, 1200));
  // Reject compressed bodies to avoid decompression bombs; clients send plain JSON.
  app.use(express.json({ limit: '256kb', strict: true, inflate: false }));
  app.use(cookieParser());
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/health/live', (_request, response) => { response.json({ status: 'ok' }); });
  app.get('/health/ready', async (_request, response) => {
    const ready = await dependencies.isDatabaseReady();
    response.setHeader('Cache-Control', 'no-store');
    response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });

  const auth = createAuthMiddleware(dependencies.tokenProvider);
  const apiKey = createApiKeyMiddleware(dependencies.projectService);
  const cookieOrigin = createCookieOriginMiddleware(config.corsOrigins);
  const credentialsLimit = createLimiter(15 * 60_000, 20);
  const refreshLimit = createLimiter(15 * 60_000, 120);
  const ingestLimit = createLimiter(60_000, 1000, (request) => request.project?.id ?? 'unauthenticated');

  const authRouter = express.Router();
  authRouter.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  authRouter.post('/register', credentialsLimit, cookieOrigin, requireJson, authController.register);
  authRouter.post('/login', credentialsLimit, cookieOrigin, requireJson, authController.login);
  authRouter.post('/refresh', refreshLimit, cookieOrigin, authController.refresh);
  authRouter.post('/logout', refreshLimit, cookieOrigin, authController.logout);
  authRouter.get('/me', auth, authController.me);
  app.use('/api/v1/auth', authRouter);

  app.post('/api/v1/projects', auth, requireJson, projectController.create);
  app.get('/api/v1/projects', auth, projectController.list);
  app.post('/api/v1/logs', apiKey, ingestLimit, requireJson, logController.ingest);
  app.get('/api/v1/projects/:projectId/logs', auth, logController.fetch);
  const monitoring = dependencies.monitoringController;
  const missingMonitor: RequestHandler = () => { throw new AppError(503, 'MONITOR_NOT_CONFIGURED', 'Monitoring is not available'); };
  const monitorLimit = createLimiter(60_000, 4);
  app.get('/api/v1/monitoring/ceir', auth, monitoring?.read ?? missingMonitor);
  app.post('/api/v1/monitoring/ceir/check', auth, monitorLimit, requireJson, monitoring?.check ?? missingMonitor);
  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
