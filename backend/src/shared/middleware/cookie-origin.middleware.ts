import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

/** A custom header forces a browser preflight; exact Origin checks prevent cookie CSRF. */
export function createCookieOriginMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  return (request, _response, next) => {
    const origin = request.get('Origin');
    if (request.get('X-CSRF-Protection') !== '1' || (origin !== undefined && !allowedOrigins.includes(origin))) {
      throw new AppError(403, 'CSRF_REJECTED', 'Request origin or CSRF header is invalid');
    }
    next();
  };
}
