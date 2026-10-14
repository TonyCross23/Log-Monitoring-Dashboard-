import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config/config.types.js';
import type { PasswordHasher, RefreshSessionRepository, UserRepository } from '../src/features/auth/auth.ports.js';
import type { LogRepository } from '../src/features/logs/log.repository.js';
import type { ProjectRepository } from '../src/features/projects/project.repository.js';
import { AuthService } from '../src/features/auth/auth.service.js';
import { LogService } from '../src/features/logs/log.service.js';
import { ProjectService } from '../src/features/projects/project.service.js';
import { JwtTokenProvider } from '../src/features/auth/security/jwt-token-provider.js';
import { createLogger } from '../src/shared/logger.js';
import { AuthController } from '../src/features/auth/auth.controller.js';
import { LogController } from '../src/features/logs/log.controller.js';
import { ProjectController } from '../src/features/projects/project.controller.js';

const errorSchema = z.object({ error: z.object({ code: z.string() }), requestId: z.uuid() });

function fixture(production = false) {
  const config: AppConfig = {
    nodeEnv: production ? 'production' : 'test', port: 3001,
    databaseUrl: 'postgresql://unused:unused@localhost/unused_test',
    corsOrigins: ['https://dashboard.example.com'],
    jwtAccessSecret: 'a'.repeat(96), jwtRefreshSecret: 'r'.repeat(96),
    jwtIssuer: 'test-api', jwtAccessAudience: 'dashboard', jwtRefreshAudience: 'refresh',
    accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 2_592_000,
    bcryptRounds: 10, cookieSecure: production, cookieSameSite: 'strict', trustProxy: false,
    logLevel: 'silent',
  };
  const users: UserRepository = {
    create: vi.fn(), findByEmail: vi.fn(async () => null), findById: vi.fn(async () => null),
  };
  const sessions: RefreshSessionRepository = { createFamily: vi.fn(), rotate: vi.fn(), revokeFamily: vi.fn() };
  const passwords: PasswordHasher = { hash: vi.fn(), verify: vi.fn(async () => true), verifyDummy: vi.fn(async () => undefined) };
  const projects: ProjectRepository = {
    create: vi.fn(), listOwned: vi.fn(async () => []), findOwnedById: vi.fn(async () => null),
    findByApiKeyHash: vi.fn(async () => null),
  };
  const logs: LogRepository = { create: vi.fn(), findMany: vi.fn(async () => []) };
  const tokens = new JwtTokenProvider(config);
  const projectService = new ProjectService(projects);
  const ready = vi.fn(async () => false);
  const app = createApp({
    config, tokenProvider: tokens, projectService, logger: createLogger(config),
    authController: new AuthController(new AuthService(users, sessions, passwords, tokens), config),
    projectController: new ProjectController(projectService),
    logController: new LogController(new LogService(logs, projects)), isDatabaseReady: ready,
  });
  return { app, tokens, users, projects, logs, ready, config };
}

describe('HTTP security boundaries', () => {
  it('blocks absent CSRF headers and untrusted origins before auth work', async () => {
    const { app, users } = fixture();
    const missing = await request(app).post('/api/v1/auth/login').send({ email: 'a@example.com', password: 'x' });
    expect(missing.status).toBe(403);
    expect(errorSchema.parse(missing.body as unknown).error.code).toBe('CSRF_REJECTED');
    const hostile = await request(app).post('/api/v1/auth/refresh')
      .set('Origin', 'https://attacker.example').set('X-CSRF-Protection', '1');
    expect(hostile.status).toBe(403);
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('allows credentialed preflight only for an exact allowed origin', async () => {
    const { app, config } = fixture();
    const accepted = await request(app).options('/api/v1/auth/refresh')
      .set('Origin', config.corsOrigins[0] ?? '').set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-CSRF-Protection');
    expect(accepted.status).toBe(204);
    expect(accepted.headers['access-control-allow-origin']).toBe(config.corsOrigins[0]);
    expect(accepted.headers['access-control-allow-credentials']).toBe('true');
    const rejected = await request(app).options('/api/v1/auth/refresh')
      .set('Origin', 'https://dashboard.example.com.attacker.example').set('Access-Control-Request-Method', 'POST');
    expect(rejected.status).toBe(403);
  });

  it('normalizes malformed and oversized JSON as client errors', async () => {
    const { app } = fixture();
    const malformed = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"broken":');
    expect(malformed.status).toBe(400);
    expect(errorSchema.parse(malformed.body as unknown).error.code).toBe('INVALID_JSON');
    const oversized = await request(app).post('/api/v1/logs').send({ message: 'x'.repeat(270_000) });
    expect(oversized.status).toBe(413);
    expect(errorSchema.parse(oversized.body as unknown).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('requires JSON and rejects unknown payload/query fields', async () => {
    const { app, users } = fixture();
    const contentType = await request(app).post('/api/v1/auth/login').set('X-CSRF-Protection', '1').type('form').send('email=a@example.com');
    expect(contentType.status).toBe(415);
    const unknown = await request(app).post('/api/v1/auth/login').set('X-CSRF-Protection', '1')
      .send({ email: 'a@example.com', password: 'x', role: 'admin' });
    expect(unknown.status).toBe(400);
    const extraQuery = await request(app).post('/api/v1/auth/refresh?accessToken=ignored').set('X-CSRF-Protection', '1');
    expect(extraQuery.status).toBe(400);
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('requires an access token for projects and never accepts refresh tokens', async () => {
    const { app, tokens, projects } = fixture();
    const absent = await request(app).get('/api/v1/projects');
    expect(absent.status).toBe(401);
    const refresh = tokens.generateRefresh(randomUUID(), randomUUID(), randomUUID(), new Date(Date.now() + 3_600_000));
    const confused = await request(app).get('/api/v1/projects').set('Authorization', `Bearer ${refresh}`);
    expect(confused.status).toBe(401);
    expect(projects.listOwned).not.toHaveBeenCalled();
  });

  it('validates pagination and project params before any database lookup', async () => {
    const { app, tokens, projects } = fixture();
    const access = tokens.generateAccess(randomUUID()).token;
    const invalidLimit = await request(app).get(`/api/v1/projects/${randomUUID()}/logs?limit=101`).auth(access, { type: 'bearer' });
    expect(invalidLimit.status).toBe(400);
    const invalidId = await request(app).get('/api/v1/projects/not-a-uuid/logs').auth(access, { type: 'bearer' });
    expect(invalidId.status).toBe(400);
    expect(projects.findOwnedById).not.toHaveBeenCalled();
  });

  it('validates API keys before ingestion and responds uniformly', async () => {
    const { app, projects, logs } = fixture();
    for (const key of ['', 'invalid', `lmd_${'a'.repeat(43)}`]) {
      const response = await request(app).post('/api/v1/logs').set('X-API-Key', key).send({ level: 'INFO', message: 'event' });
      expect(response.status).toBe(401);
    }
    expect(projects.findByApiKeyHash).toHaveBeenCalledTimes(1);
    expect(logs.create).not.toHaveBeenCalled();
  });

  it('expires the production refresh cookie with its secure attributes on logout', async () => {
    const { app } = fixture(true);
    const response = await request(app).post('/api/v1/auth/logout').set('X-CSRF-Protection', '1');
    expect(response.status).toBe(204);
    const cookies: unknown = response.headers['set-cookie'];
    const cookie = z.array(z.string()).parse(cookies)[0];
    expect(cookie).toContain('__Secure-refresh_token=');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('keeps database failure out of liveness and reports readiness separately', async () => {
    const { app, ready } = fixture();
    expect((await request(app).get('/health/live')).status).toBe(200);
    expect((await request(app).get('/health/ready')).status).toBe(503);
    ready.mockResolvedValue(true);
    expect((await request(app).get('/health/ready')).status).toBe(200);
  });

  it('rate limits login attempts even when clients spoof forwarded addresses', async () => {
    const { app } = fixture();
    for (let index = 0; index < 20; index += 1) {
      const response = await request(app).post('/api/v1/auth/login').set('X-CSRF-Protection', '1')
        .set('X-Forwarded-For', `192.0.2.${index}`).send({ email: 'a@example.com', password: 'x' });
      expect(response.status).toBe(401);
    }
    const denied = await request(app).post('/api/v1/auth/login').set('X-CSRF-Protection', '1')
      .set('X-Forwarded-For', '192.0.2.100').send({ email: 'a@example.com', password: 'x' });
    expect(denied.status).toBe(429);
    expect(errorSchema.parse(denied.body as unknown).error.code).toBe('RATE_LIMITED');
  });
});
