import 'dotenv/config';
import { X509Certificate } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { AppConfig } from './config.types.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const boundedInteger = (minimum: number, maximum: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(minimum).max(maximum));
const optionalPath = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).max(4096).optional());

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: boundedInteger(1, 65_535).default(3001),
  DATABASE_URL: z.string().url().refine((url) => /^postgres(?:ql)?:\/\//.test(url), 'Use a PostgreSQL URL'),
  CORS_ORIGINS: z.string().min(1).default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(64),
  JWT_REFRESH_SECRET: z.string().min(64),
  JWT_ISSUER: z.string().min(1).default('log-monitoring-api'),
  JWT_ACCESS_AUDIENCE: z.string().min(1).default('log-monitoring-dashboard'),
  JWT_REFRESH_AUDIENCE: z.string().min(1).default('log-monitoring-refresh'),
  ACCESS_TOKEN_TTL_SECONDS: boundedInteger(60, 900).default(900),
  REFRESH_TOKEN_TTL_SECONDS: boundedInteger(3600, 2_592_000).default(2_592_000),
  BCRYPT_ROUNDS: boundedInteger(10, 15).default(12),
  COOKIE_SECURE: booleanString.optional(),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  TRUST_PROXY: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CEIR_MONITOR_ENABLED: booleanString.default(false),
  CEIR_CONNECT_ADDRESS: z.string().refine((value) => isIP(value) === 4, 'Use an IPv4 address').default('192.168.11.201'),
  CEIR_CA_CERT_PATH: optionalPath,
  CEIR_CHECK_INTERVAL_SECONDS: boundedInteger(30, 3600).default(60),
  CEIR_CHECK_TIMEOUT_MS: boundedInteger(1000, 15000).default(8000),
}).superRefine((env, context) => {
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    context.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'Token secrets must be different' });
  }
  if (env.JWT_ACCESS_AUDIENCE === env.JWT_REFRESH_AUDIENCE) {
    context.addIssue({ code: 'custom', path: ['JWT_REFRESH_AUDIENCE'], message: 'Token audiences must be different' });
  }
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === false) {
    context.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Production cookies require HTTPS' });
  }
  if (env.COOKIE_SAME_SITE === 'none' && !(env.COOKIE_SECURE ?? env.NODE_ENV === 'production')) {
    context.addIssue({ code: 'custom', path: ['COOKIE_SAME_SITE'], message: 'SameSite none requires secure cookies' });
  }
});

/** Validate configuration before opening a socket. Never print environment values. */
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const failures = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${failures}`);
  }
  const env = parsed.data;
  let caCertificate: string | undefined;
  if (env.CEIR_MONITOR_ENABLED && env.CEIR_CA_CERT_PATH) {
    try {
      if (statSync(env.CEIR_CA_CERT_PATH).size > 65_536) throw new Error('Oversized CA');
      const pem = readFileSync(env.CEIR_CA_CERT_PATH, 'utf8');
      const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
      if (!certificates?.length || /PRIVATE KEY/.test(pem)) throw new Error('Expected public CA certificates');
      for (const certificate of certificates) {
        const x509 = new X509Certificate(certificate);
        if (!x509.ca || Date.parse(x509.validFrom) > Date.now() || Date.parse(x509.validTo) <= Date.now()) throw new Error('Invalid CA');
      }
      caCertificate = pem;
    } catch {
      throw new Error('CEIR_CA_CERT_PATH must reference readable, currently valid public CA certificates, without private keys');
    }
  }
  const origins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS must contain valid HTTP origins'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
      throw new Error('CORS_ORIGINS must contain exact HTTP origins without paths or credentials');
    }
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('Production CORS_ORIGINS must use HTTPS');
    }
  }
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    corsOrigins: origins,
    jwtAccessSecret: env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    jwtIssuer: env.JWT_ISSUER,
    jwtAccessAudience: env.JWT_ACCESS_AUDIENCE,
    jwtRefreshAudience: env.JWT_REFRESH_AUDIENCE,
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
    bcryptRounds: env.BCRYPT_ROUNDS,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    cookieSameSite: env.COOKIE_SAME_SITE,
    // Configure only exact proxy IPs/CIDRs. A blanket `true` permits client IP spoofing.
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY.split(',').map((value) => value.trim()) : false,
    logLevel: env.LOG_LEVEL,
    ...(env.CEIR_MONITOR_ENABLED ? {
      ceirMonitoring: {
        intervalSeconds: env.CEIR_CHECK_INTERVAL_SECONDS,
        timeoutMs: env.CEIR_CHECK_TIMEOUT_MS,
        connectAddress: env.CEIR_CONNECT_ADDRESS,
        ...(caCertificate ? { caCertificate } : {}),
      },
    } : {}),
  };
}
