import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../../config/config.types.js';
import type { AuthService } from './auth.service.js';
import type { AuthSession } from './auth.types.js';
import { AppError } from '../../shared/errors/app-error.js';
import { emptyBodySchema, emptyInputSchema, loginSchema, registerSchema } from './auth.schemas.js';

export function refreshCookieName(config: AppConfig): string {
  return config.nodeEnv === 'production' ? '__Secure-refresh_token' : 'refresh_token';
}

export class AuthController {
  private readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly service: AuthService,
    config: AppConfig,
  ) {
    this.cookieName = refreshCookieName(config);
    this.cookieOptions = {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: config.cookieSameSite,
      path: '/api/v1/auth',
    };
  }

  readonly register: RequestHandler = async (request, response) => {
    this.validateRouteInputs(request);
    const input = registerSchema.parse(request.body as unknown);
    const user = await this.service.register(input);
    response.status(201).json({ data: { user } });
  };

  readonly login: RequestHandler = async (request, response) => {
    this.validateRouteInputs(request);
    const input = loginSchema.parse(request.body as unknown);
    const session = await this.service.login(input);
    this.sendSession(response, session);
  };

  readonly refresh: RequestHandler = async (request, response) => {
    this.validateRouteInputs(request);
    emptyBodySchema.parse(request.body as unknown);
    const token = this.readRefreshCookie(request);
    if (!token) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'A refresh session is required.');
    }
    try {
      const session = await this.service.refresh(token);
      this.sendSession(response, session);
    } catch (error: unknown) {
      if (error instanceof AppError && error.statusCode === 401) {
        response.clearCookie(this.cookieName, this.cookieOptions);
      }
      throw error;
    }
  };

  readonly logout: RequestHandler = async (request, response) => {
    // Always expire the browser cookie, including malformed or already-revoked tokens.
    response.clearCookie(this.cookieName, this.cookieOptions);
    this.validateRouteInputs(request);
    emptyBodySchema.parse(request.body as unknown);
    await this.service.logout(this.readRefreshCookie(request));
    response.status(204).send();
  };

  readonly me: RequestHandler = async (request, response) => {
    this.validateRouteInputs(request);
    emptyBodySchema.parse(request.body as unknown);
    if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    const user = await this.service.getUser(request.auth.userId);
    response.status(200).json({ data: { user } });
  };

  private validateRouteInputs(request: Request): void {
    emptyInputSchema.parse(request.params);
    emptyInputSchema.parse(request.query);
  }

  private readRefreshCookie(request: Request): string | undefined {
    const cookies: unknown = request.cookies;
    if (typeof cookies !== 'object' || cookies === null || Array.isArray(cookies)) return undefined;
    const cookie: unknown = (cookies as Record<string, unknown>)[this.cookieName];
    return typeof cookie === 'string' && cookie.length <= 4_096 ? cookie : undefined;
  }

  private sendSession(response: Response, session: AuthSession): void {
    response.cookie(this.cookieName, session.refreshToken, {
      ...this.cookieOptions,
      expires: session.refreshExpiresAt,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      data: {
        user: session.user,
        accessToken: session.accessToken,
        tokenType: 'Bearer',
        expiresIn: session.expiresIn,
      },
    });
  }
}
