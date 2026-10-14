import pino from 'pino';
import type { AppConfig } from '../config/config.types.js';

export function createLogger(config: Pick<AppConfig, 'logLevel'>): pino.Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', 'res.headers["set-cookie"]', 'password', 'passwordHash', 'accessToken', 'refreshToken', 'apiKey', 'tokenHash', 'swaggerPassword', 'SWAGGER_PASSWORD', '*.swaggerPassword'],
      censor: '[REDACTED]',
    },
  });
}
