import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export const requireJson: RequestHandler = (request, _response, next) => {
  if (!request.is('application/json')) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json');
  next();
};
