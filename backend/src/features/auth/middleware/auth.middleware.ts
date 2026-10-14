import type { RequestHandler } from 'express';
import type { TokenProvider } from '../auth.ports.js';
import { AppError } from '../../../shared/errors/app-error.js';

export function createAuthMiddleware(tokens: TokenProvider): RequestHandler {
  return (request, _response, next): void => {
    try {
      const authorization = request.headers.authorization;
      const match = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/i.exec(authorization) : null;
      const token = match?.[1];
      if (!token) throw new AppError(401, 'UNAUTHORIZED', 'A Bearer access token is required.');
      request.auth = tokens.verifyAccess(token);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}
