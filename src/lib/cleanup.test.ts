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
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ locked: true }] as any);
  prisma.loginAttempt.deleteMany.mockResolvedValue({ count: 0 } as any);
  prisma.inviteToken.deleteMany.mockResolvedValue({ count: 0 } as any);
  prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 } as any);
  prisma.auditLog.deleteMany.mockResolvedValue({ count: 0 } as any);
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

  it('deletes AuditLog rows older than ~90 days', async () => {
    await runRetentionCleanup();

    const call = prisma.auditLog.deleteMany.mock.calls[0][0] as any;
    const cutoff = call.where.createdAt.lt as Date;
    const ageMs = Date.now() - cutoff.getTime();

    expect(ageMs).toBeGreaterThan(89 * DAY_MS);
    expect(ageMs).toBeLessThan(91 * DAY_MS);
  });

  it('does not throw when all four deletes report zero rows removed', async () => {
    await expect(runRetentionCleanup()).resolves.toBeUndefined();
  });

  // Regression coverage: instrumentation.ts schedules this cron job in every
  // server process, so a horizontally-scaled deployment would otherwise run
  // the exact same deletes on every instance at once — the advisory lock
  // means only the instance that acquires it does any work.
  it('skips all deletes when another instance already holds the retention lock', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ locked: false }] as any);

    await runRetentionCleanup();

    expect(prisma.loginAttempt.deleteMany).not.toHaveBeenCalled();
    expect(prisma.inviteToken.deleteMany).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('releases the advisory lock after a successful run', async () => {
    await runRetentionCleanup();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // acquire + release
  });

  it('releases the advisory lock even when a delete fails', async () => {
    prisma.auditLog.deleteMany.mockRejectedValue(new Error('connection lost'));

    await expect(runRetentionCleanup()).rejects.toThrow('connection lost');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // acquire + release (in `finally`)
  });
});
