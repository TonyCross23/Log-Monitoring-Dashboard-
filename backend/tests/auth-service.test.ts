import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/features/auth/auth.service.js';
import type {
  PasswordHasher,
  RefreshSessionRepository,
  TokenProvider,
  UserRepository,
} from '../src/features/auth/auth.ports.js';
import type {
  AccessClaims,
  NewRefreshFamily,
  RefreshClaims,
  RotateRefreshSession,
  RotationResult,
  User,
} from '../src/features/auth/auth.types.js';
import { AppError } from '../src/shared/errors/app-error.js';

class FakeUsers implements UserRepository {
  constructor(public user: User | null) {}

  async create(input: { email: string; name: string; passwordHash: string }): Promise<User> {
    const now = new Date();
    this.user = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    return this.user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.user?.email === email ? this.user : null;
  }

  async findById(id: string): Promise<User | null> {
    return this.user?.id === id ? this.user : null;
  }
}

class FakePasswords implements PasswordHasher {
  dummyComparisons = 0;

  async hash(password: string): Promise<string> {
    return `hashed:${password}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    return hash === `hashed:${password}`;
  }

  async verifyDummy(_password: string): Promise<void> {
    this.dummyComparisons += 1;
  }
}

class FakeTokens implements TokenProvider {
  readonly refreshTtlSeconds = 2_592_000;
  private readonly refreshClaims = new Map<string, RefreshClaims>();

  generateId(): string {
    return randomUUID();
  }

  generateAccess(userId: string): { token: string; expiresIn: number } {
    return { token: `access:${userId}`, expiresIn: 900 };
  }

  generateRefresh(userId: string, sessionId: string, familyId: string, expiresAt: Date): string {
    const token = `refresh:${sessionId}`;
    this.refreshClaims.set(token, { userId, tokenId: sessionId, familyId, expiresAt });
    return token;
  }

  verifyAccess(_token: string): AccessClaims {
    throw new Error('Not used in service tests.');
  }

  verifyRefresh(token: string): RefreshClaims {
    const claims = this.refreshClaims.get(token);
    if (!claims) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token.');
    return claims;
  }

  hashRefreshToken(token: string): string {
    return `hashed:${token}`;
  }
}

class FakeSessions implements RefreshSessionRepository {
  family: NewRefreshFamily | undefined;
  consumed = new Set<string>();
  hashes = new Map<string, string>();
  revoked = false;
  rotations: RotateRefreshSession[] = [];
  revocations = 0;

  async createFamily(input: NewRefreshFamily): Promise<void> {
    this.family = input;
    this.hashes.set(input.session.id, input.session.tokenHash);
  }

  async rotate(input: RotateRefreshSession): Promise<RotationResult> {
    this.rotations.push(input);
    if (
      this.revoked ||
      this.family?.id !== input.familyId ||
      this.family.userId !== input.userId ||
      this.hashes.get(input.sessionId) !== input.tokenHash
    ) {
      return 'invalid';
    }
    // All state updates happen synchronously before this promise yields, like a lock.
    if (this.consumed.has(input.sessionId)) {
      this.revoked = true;
      return 'reused';
    }
    this.consumed.add(input.sessionId);
    this.hashes.set(input.nextSession.id, input.nextSession.tokenHash);
    return 'rotated';
  }

  async revokeFamily(familyId: string, userId: string, _now: Date): Promise<void> {
    this.revocations += 1;
    if (this.family?.id === familyId && this.family.userId === userId) this.revoked = true;
  }
}

function setup(): {
  service: AuthService;
  users: FakeUsers;
  passwords: FakePasswords;
  sessions: FakeSessions;
  tokens: FakeTokens;
  user: User;
} {
  const now = new Date();
  const user: User = {
    id: randomUUID(),
    email: 'person@example.com',
    name: 'Person',
    passwordHash: 'hashed:correct password',
    createdAt: now,
    updatedAt: now,
  };
  const users = new FakeUsers(user);
  const passwords = new FakePasswords();
  const sessions = new FakeSessions();
  const tokens = new FakeTokens();
  return { service: new AuthService(users, sessions, passwords, tokens), users, passwords, sessions, tokens, user };
}

describe('auth service', () => {
  it('hashes registration passwords and exposes only public fields', async () => {
    const { service, users } = setup();
    const registered = await service.register({ email: 'new@example.com', name: 'New', password: 'new password' });
    expect(users.user?.passwordHash).toBe('hashed:new password');
    expect(registered).not.toHaveProperty('passwordHash');
    expect(registered).not.toHaveProperty('updatedAt');
  });

  it('uses a dummy comparison for unknown users and a uniform credentials error', async () => {
    const { service, passwords } = setup();
    await expect(service.login({ email: 'unknown@example.com', password: 'incorrect' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(passwords.dummyComparisons).toBe(1);
    await expect(service.login({ email: 'person@example.com', password: 'incorrect' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('persists only token hashes and keeps the original absolute expiry through rotation', async () => {
    const { service, sessions } = setup();
    const first = await service.login({ email: 'person@example.com', password: 'correct password' });
    expect(sessions.family?.session.tokenHash).toBe(`hashed:${first.refreshToken}`);
    expect(sessions.family).not.toHaveProperty('refreshToken');
    const next = await service.refresh(first.refreshToken);
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect(next.refreshExpiresAt).toEqual(first.refreshExpiresAt);
    expect(sessions.rotations[0]?.nextSession.expiresAt).toEqual(first.refreshExpiresAt);
  });

  it('rejects replay after the repository commits family revocation', async () => {
    const { service, sessions } = setup();
    const first = await service.login({ email: 'person@example.com', password: 'correct password' });
    const next = await service.refresh(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    expect(sessions.revoked).toBe(true);
    await expect(service.refresh(next.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('makes simultaneous refreshes expose one success and revoke its family after reuse', async () => {
    const { service, sessions } = setup();
    const first = await service.login({ email: 'person@example.com', password: 'correct password' });
    const results = await Promise.allSettled([service.refresh(first.refreshToken), service.refresh(first.refreshToken)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(sessions.revoked).toBe(true);
  });

  it('makes missing or invalid logout tokens idempotent and revokes valid sessions', async () => {
    const { service, sessions } = setup();
    await service.logout(undefined);
    await service.logout('invalid');
    expect(sessions.revocations).toBe(0);
    const first = await service.login({ email: 'person@example.com', password: 'correct password' });
    await service.logout(first.refreshToken);
    await service.logout(first.refreshToken);
    expect(sessions.revoked).toBe(true);
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});
