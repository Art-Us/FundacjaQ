import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');

import { prisma as prismaImport } from './prisma';
import { runRetentionCleanup } from './cleanup';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  mockReset(prisma);
  prisma.loginAttempt.deleteMany.mockResolvedValue({ count: 0 } as any);
  prisma.inviteToken.deleteMany.mockResolvedValue({ count: 0 } as any);
  prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 } as any);
});

describe('runRetentionCleanup', () => {
  it('deletes LoginAttempt rows older than ~90 days', async () => {
    await runRetentionCleanup();

    const call = prisma.loginAttempt.deleteMany.mock.calls[0][0] as any;
    const cutoff = call.where.createdAt.lt as Date;
    const ageMs = Date.now() - cutoff.getTime();

    expect(ageMs).toBeGreaterThan(89 * DAY_MS);
    expect(ageMs).toBeLessThan(91 * DAY_MS);
  });

  it('deletes InviteToken rows expired more than ~30 days ago', async () => {
    await runRetentionCleanup();

    const call = prisma.inviteToken.deleteMany.mock.calls[0][0] as any;
    const cutoff = call.where.expiresAt.lt as Date;
    const ageMs = Date.now() - cutoff.getTime();

    expect(ageMs).toBeGreaterThan(29 * DAY_MS);
    expect(ageMs).toBeLessThan(31 * DAY_MS);
  });

  it('deletes PasswordResetToken rows expired more than ~30 days ago', async () => {
    await runRetentionCleanup();

    const call = prisma.passwordResetToken.deleteMany.mock.calls[0][0] as any;
    const cutoff = call.where.expiresAt.lt as Date;
    const ageMs = Date.now() - cutoff.getTime();

    expect(ageMs).toBeGreaterThan(29 * DAY_MS);
    expect(ageMs).toBeLessThan(31 * DAY_MS);
  });

  it('does not throw when all three deletes report zero rows removed', async () => {
    await expect(runRetentionCleanup()).resolves.toBeUndefined();
  });
});
