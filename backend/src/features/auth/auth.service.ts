import { AppError } from '../../shared/errors/app-error.js';
import type {
  PasswordHasher,
  RefreshSessionRepository,
  TokenProvider,
  UserRepository,
} from './auth.ports.js';
import type {
  AuthSession,
  LoginInput,
  PublicUser,
  RefreshClaims,
  RegisterInput,
  User,
} from './auth.types.js';

function publicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: RefreshSessionRepository,
    private readonly passwords: PasswordHasher,
    private readonly tokens: TokenProvider,
  ) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const passwordHash = await this.passwords.hash(input.password);
    // The repository enforces uniqueness atomically; a pre-check would race.
    const user = await this.users.create({ email: input.email, name: input.name, passwordHash });
    return publicUser(user);
  }

  async login(input: LoginInput): Promise<AuthSession> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      throw this.invalidCredentials();
    }
    if (!(await this.passwords.verify(input.password, user.passwordHash))) {
      throw this.invalidCredentials();
    }

    const familyId = this.tokens.generateId();
    const sessionId = this.tokens.generateId();
    // JWT expiration has second precision; preserve one absolute family lifetime.
    const expiresAt = new Date(
      (Math.floor(Date.now() / 1_000) + this.tokens.refreshTtlSeconds) * 1_000,
    );
    const refreshToken = this.tokens.generateRefresh(user.id, sessionId, familyId, expiresAt);
    await this.sessions.createFamily({
      id: familyId,
      userId: user.id,
      expiresAt,
      session: {
        id: sessionId,
        tokenHash: this.tokens.hashRefreshToken(refreshToken),
        expiresAt,
      },
    });
    return this.sessionResponse(user, refreshToken, expiresAt);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const user = await this.users.findById(claims.userId);
    if (!user) throw this.invalidRefresh();

    const nextSessionId = this.tokens.generateId();
    const nextToken = this.tokens.generateRefresh(
      user.id,
      nextSessionId,
      claims.familyId,
      claims.expiresAt,
    );
    const result = await this.sessions.rotate({
      familyId: claims.familyId,
      sessionId: claims.tokenId,
      userId: claims.userId,
      tokenHash: this.tokens.hashRefreshToken(refreshToken),
      now: new Date(),
      nextSession: {
        id: nextSessionId,
        tokenHash: this.tokens.hashRefreshToken(nextToken),
        expiresAt: claims.expiresAt,
      },
    });
    if (result !== 'rotated') {
      // Reuse revocation has already committed before this error leaves the service.
      throw this.invalidRefresh();
    }
    return this.sessionResponse(user, nextToken, claims.expiresAt);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    let claims: RefreshClaims;
    try {
      claims = this.tokens.verifyRefresh(refreshToken);
    } catch (error: unknown) {
      if (error instanceof AppError && error.statusCode === 401) return;
      throw error;
    }
    await this.sessions.revokeFamily(claims.familyId, claims.userId, new Date());
  }

  async getUser(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    return publicUser(user);
  }

  private sessionResponse(user: User, refreshToken: string, refreshExpiresAt: Date): AuthSession {
    const access = this.tokens.generateAccess(user.id);
    return {
      user: publicUser(user),
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken,
      refreshExpiresAt,
    };
  }

  private invalidCredentials(): AppError {
    return new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  private invalidRefresh(): AppError {
    return new AppError(401, 'INVALID_REFRESH_TOKEN', 'The refresh session is invalid or expired.');
  }
}
