import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/config.types.js';
import { JwtTokenProvider } from '../src/features/auth/security/jwt-token-provider.js';
import { loginSchema, registerSchema } from '../src/features/auth/auth.schemas.js';

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    corsOrigins: ['http://localhost:5173'],
    jwtAccessSecret: 'access-secret-'.repeat(8),
    jwtRefreshSecret: 'refresh-secret-'.repeat(8),
    jwtIssuer: 'log-monitoring',
    jwtAccessAudience: 'dashboard',
    jwtRefreshAudience: 'refresh',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
    bcryptRounds: 4,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    logLevel: 'silent',
  };
}

describe('JWT token provider', () => {
  it('issues and verifies separate access and refresh tokens', () => {
    const provider = new JwtTokenProvider(config());
    const userId = randomUUID();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const expiresAt = new Date((Math.floor(Date.now() / 1_000) + 3600) * 1_000);
    const access = provider.generateAccess(userId);
    const refresh = provider.generateRefresh(userId, sessionId, familyId, expiresAt);

    expect(provider.verifyAccess(access.token).userId).toBe(userId);
    expect(access.expiresIn).toBe(900);
    expect(provider.verifyRefresh(refresh)).toEqual({
      userId,
      tokenId: sessionId,
      familyId,
      expiresAt,
    });
    expect(provider.hashRefreshToken(refresh)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => provider.verifyAccess(refresh)).toThrow();
    expect(() => provider.verifyRefresh(access.token)).toThrow();
  });

  it('rejects algorithm, audience, token-use, UUID, expiration and missing-expiry confusion', () => {
    const settings = config();
    const provider = new JwtTokenProvider(settings);
    const now = Math.floor(Date.now() / 1_000);
    const payload = {
      tokenUse: 'access',
      sub: randomUUID(),
      jti: randomUUID(),
      iat: now,
      exp: now + 900,
      iss: settings.jwtIssuer,
      aud: settings.jwtAccessAudience,
    };
    const invalidPayloads: Array<Record<string, unknown>> = [
      { ...payload, aud: settings.jwtRefreshAudience },
      { ...payload, tokenUse: 'refresh' },
      { ...payload, sub: 'user-123' },
      { ...payload, jti: 'session-123' },
      { ...payload, exp: now - 1 },
      { ...payload, iat: now + 60 },
    ];
    for (const invalid of invalidPayloads) {
      const token = jwt.sign(invalid, settings.jwtAccessSecret, { algorithm: 'HS256' });
      expect(() => provider.verifyAccess(token)).toThrow();
    }
    const wrongAlgorithm = jwt.sign(payload, settings.jwtAccessSecret, { algorithm: 'HS384' });
    expect(() => provider.verifyAccess(wrongAlgorithm)).toThrow();
    const { exp: _expiry, ...withoutExpiry } = payload;
    const noExpiry = jwt.sign(withoutExpiry, settings.jwtAccessSecret, { algorithm: 'HS256' });
    expect(() => provider.verifyAccess(noExpiry)).toThrow();
  });

  it('requires distinct signing secrets', () => {
    const settings = config();
    settings.jwtRefreshSecret = settings.jwtAccessSecret;
    expect(() => new JwtTokenProvider(settings)).toThrow('must be different');
  });
});

describe('auth request schemas', () => {
  it('normalizes email without changing passwords and rejects unknown fields', () => {
    expect(
      registerSchema.parse({ email: ' PERSON@Example.COM ', name: ' Person ', password: ' strong password ' }),
    ).toEqual({ email: 'person@example.com', name: 'Person', password: ' strong password ' });
    expect(() => registerSchema.parse({ email: 'a@example.com', name: 'A', password: 'short' })).toThrow();
    expect(() => loginSchema.parse({ email: 'a@example.com', password: 'x', admin: true })).toThrow();
    expect(loginSchema.parse({ email: 'a@example.com', password: 'x' }).password).toBe('x');
  });

  it('rejects passwords beyond bcrypt UTF-8 limits, including Unicode truncation', () => {
    const input = { email: 'a@example.com', name: 'A' };
    expect(registerSchema.safeParse({ ...input, password: 'a'.repeat(72) }).success).toBe(true);
    expect(registerSchema.safeParse({ ...input, password: 'a'.repeat(73) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, password: '€'.repeat(25) }).success).toBe(false);
    expect(loginSchema.safeParse({ email: input.email, password: '😀'.repeat(19) }).success).toBe(false);
  });

  it('rejects names PostgreSQL cannot encode while preserving valid multilingual names', () => {
    const input = { email: 'a@example.com', password: 'valid password' };
    expect(registerSchema.safeParse({ ...input, name: 'NUL\u0000name' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, name: 'invalid\ud800name' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, name: 'မင်္ဂလာပါ 😀' }).success).toBe(true);
  });
});
