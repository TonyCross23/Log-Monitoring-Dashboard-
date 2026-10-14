import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { PasswordHasher } from '../auth.ports.js';

export class BcryptPasswordHasher implements PasswordHasher {
  private readonly dummyHash: Promise<string>;

  constructor(private readonly rounds: number) {
    // Build this once, with the same cost as real passwords.
    this.dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), rounds);
  }

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async verifyDummy(password: string): Promise<void> {
    await bcrypt.compare(password, await this.dummyHash);
  }
}
