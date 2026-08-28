import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');
vi.mock('./redis');

import { prisma as prismaImport } from './prisma';
import { redis } from './redis';
import { checkLockout, recordFailedAttempt, resetAttempts } from './lockout';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prisma);
  prisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])) as any
  );
  vi.mocked(redis.get).mockReset();
  vi.mocked(redis.set).mockReset();
  vi.mocked(redis.del).mockReset();
});

describe('checkLockout', () => {
  it('reports locked when Redis holds a future timestamp', async () => {
    vi.mocked(redis.get).mockResolvedValue(String(Date.now() + 60_000));

    const result = await checkLockout('user@example.com');

    expect(result.locked).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to Postgres and re-populates Redis when the Redis key is missing', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    const lockedUntil = new Date(Date.now() + 60_000);
    prisma.user.findUnique.mockResolvedValue({ lockedUntil } as any);

    const result = await checkLockout('user@example.com');

    expect(result.locked).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'lockout:user@example.com',
      lockedUntil.getTime(),
      'EX',
      expect.any(Number)
    );
  });

  it('reports not locked when neither Redis nor Postgres has an active lock', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ lockedUntil: null } as any);

    const result = await checkLockout('user@example.com');

    expect(result.locked).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('reports not locked for a user that does not exist (enumeration probe)', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await checkLockout('nobody@example.com');

    expect(result.locked).toBe(false);
  });

  it('ignores an expired Redis timestamp and re-checks Postgres', async () => {
    vi.mocked(redis.get).mockResolvedValue(String(Date.now() - 1000));
    prisma.user.findUnique.mockResolvedValue({ lockedUntil: null } as any);

    const result = await checkLockout('user@example.com');

    expect(result.locked).toBe(false);
    expect(prisma.user.findUnique).toHaveBeenCalled();
  });
});

describe('recordFailedAttempt', () => {
  it('increments failedAttempts without locking below the threshold', async () => {
    prisma.user.update.mockResolvedValue({ failedAttempts: 3 } as any);

    await recordFailedAttempt('user@example.com');

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('locks the account in both Postgres and Redis once the threshold is reached', async () => {
    prisma.user.update.mockResolvedValueOnce({ failedAttempts: 20 } as any).mockResolvedValueOnce({} as any);

    await recordFailedAttempt('user@example.com');

    expect(prisma.user.update).toHaveBeenCalledTimes(2);
    expect(prisma.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lockedUntil: expect.any(Date) }) })
    );
    expect(redis.set).toHaveBeenCalledWith('lockout:user@example.com', expect.any(Number), 'EX', expect.any(Number));
  });

  it('silently no-ops for a nonexistent email instead of throwing (brute-force probe safety)', async () => {
    prisma.user.update.mockRejectedValue(new Error('Record to update not found'));

    await expect(recordFailedAttempt('nobody@example.com')).resolves.toBeUndefined();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('resetAttempts', () => {
  it('clears the Redis lock key and resets Postgres counters', async () => {
    prisma.user.update.mockResolvedValue({} as any);

    await resetAttempts('user@example.com');

    expect(redis.del).toHaveBeenCalledWith('lockout:user@example.com');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  });

  it('does not throw if the user no longer exists', async () => {
    prisma.user.update.mockRejectedValue(new Error('Record to update not found'));

    await expect(resetAttempts('nobody@example.com')).resolves.toBeUndefined();
  });
});
