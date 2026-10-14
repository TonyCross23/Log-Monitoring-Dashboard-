export interface CeirMonitoringConfig {
  intervalSeconds: number;
  timeoutMs: number;
  connectAddress: string;
  caCertificate?: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtIssuer: string;
  jwtAccessAudience: string;
  jwtRefreshAudience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  bcryptRounds: number;
  cookieSecure: boolean;
  cookieSameSite: 'strict' | 'lax' | 'none';
  trustProxy: false | string[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  ceirMonitoring?: CeirMonitoringConfig;
}
