import type {
  AccessClaims,
  AccessToken,
  NewRefreshFamily,
  RefreshClaims,
  RotateRefreshSession,
  RotationResult,
  User,
} from './auth.types.js';

export interface UserRepository {
  create(input: { email: string; name: string; passwordHash: string }): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

export interface RefreshSessionRepository {
  createFamily(input: NewRefreshFamily): Promise<void>;
  /** Rotation and replay-triggered revocation must be one serialized transaction. */
  rotate(input: RotateRefreshSession): Promise<RotationResult>;
  revokeFamily(familyId: string, userId: string, now: Date): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
  /** Run a real comparison when the email is unknown to reduce timing differences. */
  verifyDummy(password: string): Promise<void>;
}

export interface TokenProvider {
  readonly refreshTtlSeconds: number;
  generateId(): string;
  generateAccess(userId: string): AccessToken;
  generateRefresh(userId: string, sessionId: string, familyId: string, expiresAt: Date): string;
  verifyAccess(token: string): AccessClaims;
  verifyRefresh(token: string): RefreshClaims;
  hashRefreshToken(token: string): string;
}
