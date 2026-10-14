import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../../../config/config.types.js';
import type { TokenProvider } from '../auth.ports.js';
import type { AccessClaims, AccessToken, RefreshClaims } from '../auth.types.js';
import { AppError } from '../../../shared/errors/app-error.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

interface VerifiedClaims {
  sub: string;
  jti: string;
  exp: number;
  familyId: unknown;
}

export class JwtTokenProvider implements TokenProvider {
  readonly refreshTtlSeconds: number;

  constructor(private readonly config: AppConfig) {
    if (config.jwtAccessSecret === config.jwtRefreshSecret) {
      throw new Error('Access and refresh JWT secrets must be different.');
    }
    this.refreshTtlSeconds = config.refreshTokenTtlSeconds;
  }

  generateId(): string {
    return randomUUID();
  }

  generateAccess(userId: string): AccessToken {
    const token = jwt.sign({ tokenUse: 'access' }, this.config.jwtAccessSecret, {
      algorithm: 'HS256',
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAccessAudience,
      subject: userId,
      jwtid: this.generateId(),
      expiresIn: this.config.accessTokenTtlSeconds,
    });
    return { token, expiresIn: this.config.accessTokenTtlSeconds };
  }

  generateRefresh(userId: string, sessionId: string, familyId: string, expiresAt: Date): string {
    return jwt.sign(
      { tokenUse: 'refresh', familyId, exp: Math.floor(expiresAt.getTime() / 1_000) },
      this.config.jwtRefreshSecret,
      {
        algorithm: 'HS256',
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtRefreshAudience,
        subject: userId,
        jwtid: sessionId,
      },
    );
  }

  verifyAccess(token: string): AccessClaims {
    const payload = this.verify(token, 'access');
    return { userId: payload.sub, tokenId: payload.jti };
  }

  verifyRefresh(token: string): RefreshClaims {
    const payload = this.verify(token, 'refresh');
    if (!validId(payload.familyId)) throw this.invalidToken('refresh');
    return {
      userId: payload.sub,
      tokenId: payload.jti,
      familyId: payload.familyId,
      expiresAt: new Date(payload.exp * 1_000),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private verify(
    token: string,
    tokenUse: 'access' | 'refresh',
  ): VerifiedClaims {
    try {
      if (token.length > 4_096) throw this.invalidToken(tokenUse);
      const decoded: unknown = jwt.verify(
        token,
        tokenUse === 'access' ? this.config.jwtAccessSecret : this.config.jwtRefreshSecret,
        {
          algorithms: ['HS256'],
          issuer: this.config.jwtIssuer,
          audience:
            tokenUse === 'access'
              ? this.config.jwtAccessAudience
              : this.config.jwtRefreshAudience,
        },
      );
      if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        throw this.invalidToken(tokenUse);
      }
      const payload = decoded as Record<string, unknown>;
      const { sub, jti, exp, iat, tokenUse: purpose, familyId } = payload;
      if (
        purpose !== tokenUse ||
        !validId(sub) ||
        !validId(jti) ||
        typeof exp !== 'number' ||
        !Number.isSafeInteger(exp) ||
        typeof iat !== 'number' ||
        !Number.isSafeInteger(iat) ||
        exp <= iat ||
        iat > Math.floor(Date.now() / 1_000)
      ) {
        throw this.invalidToken(tokenUse);
      }
      return { sub, jti, exp, familyId };
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw this.invalidToken(tokenUse);
    }
  }

  private invalidToken(tokenUse: 'access' | 'refresh'): AppError {
    return new AppError(
      401,
      tokenUse === 'access' ? 'INVALID_ACCESS_TOKEN' : 'INVALID_REFRESH_TOKEN',
      'The authentication token is invalid or expired.',
    );
  }
}
