export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'createdAt'>;

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AccessClaims {
  userId: string;
  tokenId: string;
}

export interface RefreshClaims extends AccessClaims {
  familyId: string;
  expiresAt: Date;
}

export interface AccessToken {
  token: string;
  expiresIn: number;
}

/** Internal result: controllers remove the refresh token before serializing. */
export interface AuthSession {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface NewRefreshSession {
  id: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface NewRefreshFamily {
  id: string;
  userId: string;
  expiresAt: Date;
  session: NewRefreshSession;
}

export interface RotateRefreshSession {
  familyId: string;
  sessionId: string;
  userId: string;
  tokenHash: string;
  now: Date;
  nextSession: NewRefreshSession;
}

export type RotationResult = 'rotated' | 'reused' | 'invalid';
