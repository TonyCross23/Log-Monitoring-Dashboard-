import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) { next(error); return; }
    let failure: AppError;
    if (error instanceof AppError) {
      failure = error;
    } else if (error instanceof ZodError) {
      failure = new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', error.issues.map((issue) => ({
        path: issue.path.join('.'), code: issue.code, message: issue.message,
      })));
    } else if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
      failure = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 256 KiB');
    } else if (error instanceof Error && 'type' in error && error.type === 'entity.parse.failed') {
      failure = new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    } else if (error instanceof Error && 'status' in error && error.status === 415) {
      failure = new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported body encoding');
    } else if (error instanceof Error && 'type' in error && ['request.aborted', 'request.size.invalid'].includes(String(error.type))) {
      failure = new AppError(400, 'INVALID_BODY', 'Invalid request body');
    } else {
      logger.error({ err: error, requestId: request.requestId }, 'Request failed');
      failure = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
    if (failure.statusCode === 401) response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(failure.statusCode).json({
      success: false,
      error: { code: failure.code, message: failure.message, ...(failure.details === undefined ? {} : { details: failure.details }) },
      requestId: request.requestId,
    });
  };
}
