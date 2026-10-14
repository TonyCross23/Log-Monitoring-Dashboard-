import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { UserRepository } from '../auth.ports.js';
import type { User } from '../auth.types.js';
import { AppError } from '../../../shared/errors/app-error.js';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { email: string; name: string; passwordHash: string }): Promise<User> {
    try {
      return await this.prisma.user.create({ data: input });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
      }
      throw error;
    }
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
