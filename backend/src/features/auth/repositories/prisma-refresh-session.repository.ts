import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { RefreshSessionRepository } from '../auth.ports.js';
import type {
  NewRefreshFamily,
  RotateRefreshSession,
  RotationResult,
} from '../auth.types.js';

export class PrismaRefreshSessionRepository implements RefreshSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createFamily(input: NewRefreshFamily): Promise<void> {
    await this.prisma.refreshTokenFamily.create({
      data: {
        id: input.id,
        userId: input.userId,
        expiresAt: input.expiresAt,
        sessions: { create: input.session },
      },
    });
  }

  rotate(input: RotateRefreshSession): Promise<RotationResult> {
    return this.prisma.$transaction(async (transaction): Promise<RotationResult> => {
      // The family lock serializes rotation, replay detection and logout across instances.
      await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "RefreshTokenFamily" WHERE "id" = ${input.familyId}::uuid FOR UPDATE`,
      );
      // Re-evaluate time after waiting for the lock, so waiting cannot extend expiry.
      const now = new Date(Math.max(input.now.getTime(), Date.now()));
      const family = await transaction.refreshTokenFamily.findUnique({
        where: { id: input.familyId },
      });
      if (
        !family ||
        family.userId !== input.userId ||
        family.revokedAt !== null ||
        family.expiresAt <= now ||
        input.nextSession.expiresAt.getTime() !== family.expiresAt.getTime()
      ) {
        return 'invalid';
      }
      const currentSession = await transaction.refreshSession.findUnique({
        where: { id: input.sessionId },
      });
      if (
        !currentSession ||
        currentSession.familyId !== family.id ||
        currentSession.tokenHash !== input.tokenHash ||
        currentSession.expiresAt <= now
      ) {
        return 'invalid';
      }
      if (currentSession.consumedAt !== null) {
        await transaction.refreshTokenFamily.update({
          where: { id: family.id },
          data: { revokedAt: now },
        });
        // Returning, instead of throwing, commits the security-relevant revocation.
        return 'reused';
      }
      await transaction.refreshSession.update({
        where: { id: currentSession.id },
        data: { consumedAt: now },
      });
      await transaction.refreshSession.create({
        data: { ...input.nextSession, familyId: family.id },
      });
      return 'rotated';
    });
  }

  async revokeFamily(familyId: string, userId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (transaction): Promise<void> => {
      await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "RefreshTokenFamily" WHERE "id" = ${familyId}::uuid FOR UPDATE`,
      );
      await transaction.refreshTokenFamily.updateMany({
        where: { id: familyId, userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }
}
