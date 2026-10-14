import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AuthService } from '../src/features/auth/auth.service.js';
import { createRuntime } from '../src/composition-root.js';
import type { AppConfig } from '../src/config/config.types.js';
import type { PublicUser } from '../src/features/auth/auth.types.js';
import { BcryptPasswordHasher } from '../src/features/auth/security/bcrypt-password-hasher.js';
import { JwtTokenProvider } from '../src/features/auth/security/jwt-token-provider.js';
import { PrismaRefreshSessionRepository } from '../src/features/auth/repositories/prisma-refresh-session.repository.js';
import { PrismaUserRepository } from '../src/features/auth/repositories/prisma-user.repository.js';
import { Prisma } from '../src/generated/prisma/client.js';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (testDatabaseUrl !== undefined) {
  const databaseUrl = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseName.endsWith('_test')) {
    throw new Error('Integration tests require a PostgreSQL TEST_DATABASE_URL whose database name ends in _test.');
  }
}

const origin = 'http://localhost:5173';
const password = 'correct horse battery staple';

function testConfig(databaseUrl: string): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl,
    corsOrigins: [origin],
    jwtAccessSecret: 'integration-access-secret-'.repeat(4),
    jwtRefreshSecret: 'integration-refresh-secret-'.repeat(4),
    jwtIssuer: 'log-monitoring-integration',
    jwtAccessAudience: 'dashboard',
    jwtRefreshAudience: 'refresh',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
    bcryptRounds: 10,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    logLevel: 'silent',
  };
}

const userResponseSchema = z.object({
  data: z.object({
    user: z.object({ id: z.uuid(), email: z.email(), name: z.string(), createdAt: z.iso.datetime() }),
  }),
});
const sessionResponseSchema = z.object({
  data: z.object({
    user: z.object({ id: z.uuid(), email: z.email() }),
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().positive(),
  }),
});
const projectResponseSchema = z.object({
  data: z.object({ project: z.object({ id: z.uuid(), name: z.string() }), apiKey: z.string() }),
});
const logsResponseSchema = z.object({
  data: z.object({
    items: z.array(z.object({ id: z.uuid(), level: z.string(), message: z.string() })),
    pagination: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean(), limit: z.number() }),
  }),
});

function readCookies(headers: unknown): string[] {
  return z.array(z.string()).parse(headers);
}

function readRefreshToken(cookies: string[]): string {
  const cookie = cookies.find((value) => value.startsWith('refresh_token='));
  if (!cookie) throw new Error('Response did not contain a refresh cookie.');
  const firstPart = cookie.split(';')[0];
  if (!firstPart) throw new Error('Refresh cookie is empty.');
  return decodeURIComponent(firstPart.slice('refresh_token='.length));
}

describe.skipIf(testDatabaseUrl === undefined)('PostgreSQL integration', () => {
  let runtime: ReturnType<typeof createRuntime> | undefined;
  let service: AuthService | undefined;
  const createdUserIds = new Set<string>();

  function currentRuntime(): ReturnType<typeof createRuntime> {
    if (!runtime) throw new Error('Integration runtime is not initialized.');
    return runtime;
  }

  function authService(): AuthService {
    if (!service) throw new Error('Integration auth service is not initialized.');
    return service;
  }

  async function registerFixture(): Promise<PublicUser> {
    const user = await authService().register({
      email: `integration-${randomUUID()}@example.com`,
      name: 'Integration User',
      password,
    });
    createdUserIds.add(user.id);
    return user;
  }

  beforeAll(async () => {
    if (testDatabaseUrl === undefined) throw new Error('TEST_DATABASE_URL must be provided.');
    const config = testConfig(testDatabaseUrl);
    runtime = createRuntime(config);
    await runtime.prisma.$connect();
    service = new AuthService(
      new PrismaUserRepository(runtime.prisma),
      new PrismaRefreshSessionRepository(runtime.prisma),
      new BcryptPasswordHasher(config.bcryptRounds),
      new JwtTokenProvider(config),
    );
  });

  afterAll(async () => {
    if (runtime) {
      try {
        // Cascade cleanup is scoped exclusively to IDs created by this test run.
        if (createdUserIds.size > 0) {
          await runtime.prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
        }
      } finally {
        await runtime.prisma.$disconnect();
      }
    }
  });

  it('enforces unique email atomically during concurrent registration', async () => {
    const input = { email: `registration-race-${randomUUID()}@example.com`, name: 'Concurrent', password };
    const results = await Promise.allSettled([authService().register(input), authService().register(input)]);
    const winners: PublicUser[] = [];
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        createdUserIds.add(result.value.id);
        winners.push(result.value);
      } else {
        const failure: unknown = result.reason;
        failures.push(failure);
      }
    }
    expect(winners).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' });
  });

  it('serializes simultaneous refreshes and commits family revocation on replay', async () => {
    const user = await registerFixture();
    const first = await authService().login({ email: user.email, password });
    const results = await Promise.allSettled([
      authService().refresh(first.refreshToken),
      authService().refresh(first.refreshToken),
    ]);
    const successes = results.filter((result) => result.status === 'fulfilled');
    expect(successes).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = successes[0];
    if (!winner || winner.status !== 'fulfilled') throw new Error('Expected a successful first rotation.');
    const family = await currentRuntime().prisma.refreshTokenFamily.findFirst({ where: { userId: user.id } });
    expect(family?.revokedAt).toBeInstanceOf(Date);
    await expect(authService().refresh(winner.value.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    const sessions = await currentRuntime().prisma.refreshSession.findMany({ where: { family: { userId: user.id } } });
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.consumedAt !== null)).toHaveLength(1);
  });

  it('serializes logout against refresh so a logged-out family cannot regain validity', async () => {
    const user = await registerFixture();
    const first = await authService().login({ email: user.email, password });
    const [rotation, logout] = await Promise.allSettled([
      authService().refresh(first.refreshToken),
      authService().logout(first.refreshToken),
    ]);
    expect(logout.status).toBe('fulfilled');
    const family = await currentRuntime().prisma.refreshTokenFamily.findFirst({ where: { userId: user.id } });
    expect(family?.revokedAt).toBeInstanceOf(Date);
    if (rotation.status === 'fulfilled') {
      await expect(authService().refresh(rotation.value.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    } else {
      const failure: unknown = rotation.reason;
      expect(failure).toMatchObject({ statusCode: 401 });
    }
    await expect(authService().refresh(first.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects rotation when a family expires while waiting for its row lock', async () => {
    const user = await registerFixture();
    const { prisma } = currentRuntime();
    const repository = new PrismaRefreshSessionRepository(prisma);
    const familyId = randomUUID();
    const sessionId = randomUUID();
    const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
    await repository.createFamily({
      id: familyId, userId: user.id, expiresAt: new Date(Date.now() + 60_000),
      session: { id: sessionId, tokenHash, expiresAt: new Date(Date.now() + 60_000) },
    });
    let expiresAt = new Date();
    let signalLockAcquired: () => void = () => {};
    const lockAcquired = new Promise<void>((resolve) => { signalLockAcquired = resolve; });
    const lockHolder = prisma.$transaction(async (transaction): Promise<void> => {
      await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "RefreshTokenFamily" WHERE "id" = ${familyId}::uuid FOR UPDATE`);
      expiresAt = new Date(Date.now() + 1_000);
      await transaction.refreshTokenFamily.update({ where: { id: familyId }, data: { expiresAt } });
      await transaction.refreshSession.update({ where: { id: sessionId }, data: { expiresAt } });
      signalLockAcquired();
      await transaction.$queryRaw`SELECT 1 FROM pg_sleep(1.5)`;
    });
    await Promise.race([lockAcquired, lockHolder]);
    const result = await repository.rotate({
      familyId, sessionId, userId: user.id, tokenHash, now: new Date(),
      nextSession: {
        id: randomUUID(), tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), expiresAt,
      },
    });
    await lockHolder;
    expect(result).toBe('invalid');
    expect(await prisma.refreshSession.count({ where: { familyId } })).toBe(1);
    const originalSession = await prisma.refreshSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(originalSession.consumedAt).toBeNull();
  });

  it('runs HTTP auth, project creation, ingestion, owner filtering, stable pagination and logout', async () => {
    const { app, prisma } = currentRuntime();
    const ownerEmail = `http-owner-${randomUUID()}@example.com`;
    const agent = request.agent(app);
    const registration = await agent.post('/api/v1/auth/register')
      .set('Origin', origin).set('X-CSRF-Protection', '1')
      .send({ email: ownerEmail, name: 'HTTP Owner', password }).expect(201);
    const registrationBody: unknown = registration.body;
    const owner = userResponseSchema.parse(registrationBody).data.user;
    createdUserIds.add(owner.id);
    expect(registrationBody).not.toHaveProperty('data.user.passwordHash');

    const login = await agent.post('/api/v1/auth/login')
      .set('Origin', origin).set('X-CSRF-Protection', '1')
      .send({ email: ownerEmail, password }).expect(200);
    const loginBody: unknown = login.body;
    const loginData = sessionResponseSchema.parse(loginBody).data;
    expect(loginBody).not.toHaveProperty('data.refreshToken');
    const loginCookieHeaders: unknown = login.headers['set-cookie'];
    const loginCookies = readCookies(loginCookieHeaders);
    expect(loginCookies[0]).toContain('HttpOnly');
    expect(loginCookies[0]).toContain('Path=/api/v1/auth');
    expect(loginCookies[0]).toContain('SameSite=Lax');
    const rawRefreshToken = readRefreshToken(loginCookies);
    const storedSession = await prisma.refreshSession.findFirst({ where: { family: { userId: owner.id } } });
    expect(storedSession?.tokenHash).toBe(createHash('sha256').update(rawRefreshToken).digest('hex'));
    expect(JSON.stringify(storedSession)).not.toContain(rawRefreshToken);
    const storedUser = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(storedUser.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(storedUser.passwordHash).not.toBe(password);

    const me = await agent.get('/api/v1/auth/me').set('Authorization', `Bearer ${loginData.accessToken}`).expect(200);
    const meBody: unknown = me.body;
    expect(userResponseSchema.parse(meBody).data.user.id).toBe(owner.id);
    await agent.get('/api/v1/auth/me').expect(401);

    const rotation = await agent.post('/api/v1/auth/refresh')
      .set('Origin', origin).set('X-CSRF-Protection', '1').send({}).expect(200);
    const rotationBody: unknown = rotation.body;
    const token = sessionResponseSchema.parse(rotationBody).data.accessToken;
    const rotationCookieHeaders: unknown = rotation.headers['set-cookie'];
    const rotatedRawToken = readRefreshToken(readCookies(rotationCookieHeaders));
    expect(rotatedRawToken).not.toBe(rawRefreshToken);
    const ownerSessions = await prisma.refreshSession.findMany({ where: { family: { userId: owner.id } } });
    expect(ownerSessions).toHaveLength(2);
    expect(ownerSessions.some((session) => session.tokenHash === createHash('sha256').update(rotatedRawToken).digest('hex'))).toBe(true);
    expect(ownerSessions[0]?.expiresAt).toEqual(ownerSessions[1]?.expiresAt);

    const created = await agent.post('/api/v1/projects').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Integration Project' }).expect(201);
    const createdBody: unknown = created.body;
    const { project, apiKey } = projectResponseSchema.parse(createdBody).data;
    const storedProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(storedProject.apiKeyHash).toBe(createHash('sha256').update(apiKey).digest('hex'));
    expect(JSON.stringify(storedProject)).not.toContain(apiKey);
    expect(created.headers['cache-control']).toBe('no-store');

    const ingestion = await agent.post('/api/v1/logs').set('X-API-Key', apiKey)
      .send({ level: 'ERROR', message: 'database request failed', stackTrace: 'trace', metadata: { requestId: 'abc', retry: false } })
      .expect(201);
    const ingestionBody: unknown = ingestion.body;
    const log = z.object({ data: z.object({ id: z.uuid(), projectId: z.uuid() }) }).parse(ingestionBody).data;
    expect(log.projectId).toBe(project.id);
    await agent.post('/api/v1/logs').set('X-API-Key', `${apiKey}wrong`)
      .send({ level: 'INFO', message: 'unauthorized' }).expect(401);
    const filtered = await agent.get(`/api/v1/projects/${project.id}/logs`)
      .set('Authorization', `Bearer ${token}`).query({ level: 'ERROR', search: 'request failed', limit: '10' }).expect(200);
    const filteredBody: unknown = filtered.body;
    expect(logsResponseSchema.parse(filteredBody).data.items.map((item) => item.id)).toEqual([log.id]);

    const literalId = randomUUID();
    await prisma.log.createMany({ data: [
      { id: literalId, projectId: project.id, level: 'WARN', message: '100% request_id C:\\logs' },
      { id: randomUUID(), projectId: project.id, level: 'WARN', message: '1000 requestXid C:logs' },
    ] });
    for (const search of ['100%', 'request_id', 'C:\\logs']) {
      const literal = await agent.get(`/api/v1/projects/${project.id}/logs`)
        .set('Authorization', `Bearer ${token}`).query({ level: 'WARN', search }).expect(200);
      expect(logsResponseSchema.parse(literal.body as unknown).data.items.map((item) => item.id)).toEqual([literalId]);
    }

    const otherUser = await registerFixture();
    const otherLogin = await authService().login({ email: otherUser.email, password });
    await request(app).get(`/api/v1/projects/${project.id}/logs`)
      .set('Authorization', `Bearer ${otherLogin.accessToken}`).expect(404);

    // Explicit equal timestamps exercise the UUID tie-breaker in PostgreSQL.
    const tiedIds = Array.from({ length: 5 }, () => randomUUID());
    const sameTime = new Date('2026-01-01T12:00:00.123Z');
    await prisma.log.createMany({
      data: tiedIds.map((id) => ({ id, projectId: project.id, level: 'DEBUG', message: 'cursor fixture', createdAt: sameTime })),
    });
    const fetchedIds: string[] = [];
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const query: Record<string, string> = { level: 'DEBUG', search: 'cursor fixture', limit: '2' };
      if (cursor !== undefined) query['cursor'] = cursor;
      const page = await agent.get(`/api/v1/projects/${project.id}/logs`)
        .set('Authorization', `Bearer ${token}`).query(query).expect(200);
      const pageBody: unknown = page.body;
      const data = logsResponseSchema.parse(pageBody).data;
      fetchedIds.push(...data.items.map((item) => item.id));
      expect(data.pagination.hasMore).toBe(pageIndex < 2);
      cursor = data.pagination.nextCursor ?? undefined;
    }
    expect(fetchedIds).toEqual([...tiedIds].sort().reverse());
    expect(new Set(fetchedIds).size).toBe(tiedIds.length);
    expect(cursor).toBeUndefined();

    const logout = await agent.post('/api/v1/auth/logout')
      .set('Origin', origin).set('X-CSRF-Protection', '1').send({}).expect(204);
    const logoutCookieHeaders: unknown = logout.headers['set-cookie'];
    expect(readCookies(logoutCookieHeaders)[0]).toContain('Expires=Thu, 01 Jan 1970');
    await agent.post('/api/v1/auth/refresh').set('Origin', origin).set('X-CSRF-Protection', '1').send({}).expect(401);
  });
});
