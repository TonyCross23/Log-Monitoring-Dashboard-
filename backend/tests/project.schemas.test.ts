import { describe, expect, it } from 'vitest';
import { createProjectSchema } from '../src/features/projects/project.schemas.js';
import { isPostgresString } from '../src/shared/validation/postgres-string.js';

describe('PostgreSQL text validation', () => {
  it('rejects NUL and unpaired surrogates while accepting well-formed Unicode', () => {
    for (const invalid of ['project\u0000', '\ud800', '\udc00', '\ud800x']) {
      expect(isPostgresString(invalid)).toBe(false);
      expect(createProjectSchema.safeParse({ name: invalid }).success).toBe(false);
    }
    for (const valid of ['API', 'မြန်မာ', '😀', 'Project 😀']) {
      expect(isPostgresString(valid)).toBe(true);
      expect(createProjectSchema.safeParse({ name: valid }).success).toBe(true);
    }
  });
});
