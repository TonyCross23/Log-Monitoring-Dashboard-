import type { AccessClaims } from '../features/auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AccessClaims;
      project?: { id: string };
      requestId: string;
    }
  }
}

export {};
