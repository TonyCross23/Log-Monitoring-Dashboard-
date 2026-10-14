import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/db_test',
    JWT_ACCESS_SECRET: 'a'.repeat(96), JWT_REFRESH_SECRET: 'r'.repeat(96),
  };
}

describe('fail-fast environment validation', () => {
  it('uses bounded defaults and does not treat the string false as true', () => {
    const config = loadConfig({ ...environment(), COOKIE_SECURE: 'false' });
    expect(config.cookieSecure).toBe(false);
    expect(config.accessTokenTtlSeconds).toBe(900);
    expect(config.trustProxy).toBe(false);
  });

  it('rejects weak/equal keys, excessive access lifetimes and malformed numbers', () => {
    for (const change of [
      { JWT_ACCESS_SECRET: 'short' }, { JWT_REFRESH_SECRET: 'a'.repeat(96) },
      { ACCESS_TOKEN_TTL_SECONDS: '3600' }, { PORT: '1e3' }, { BCRYPT_ROUNDS: '4' },
    ]) expect(() => loadConfig({ ...environment(), ...change })).toThrow();
  });

  it('requires exact origins and secure production cookies', () => {
    for (const origin of ['*', 'null', 'https://example.com/path', 'https://user:pass@example.com', 'https://example.com/']) {
      expect(() => loadConfig({ ...environment(), CORS_ORIGINS: origin })).toThrow();
    }
    expect(() => loadConfig({ ...environment(), NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow();
    expect(() => loadConfig({ ...environment(), COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'false' })).toThrow();
    const config = loadConfig({ ...environment(), NODE_ENV: 'production', CORS_ORIGINS: 'https://dashboard.example.com' });
    expect(config.cookieSecure).toBe(true);
  });
});
