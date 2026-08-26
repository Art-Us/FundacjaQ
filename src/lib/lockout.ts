import { prisma } from './prisma';
import { redis } from './redis';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

function lockKey(email: string): string {
  return `lockout:${email.toLowerCase()}`;
}

export interface LockoutStatus {
  locked: boolean;
  until: Date | null;
}

/**
 * Redis is the fast path; Postgres `User.lockedUntil` is the durable source
 * of truth consulted whenever the Redis key is missing (e.g. after a Redis
 * restart) so a lock can never be silently dropped.
 */
export async function checkLockout(email: string): Promise<LockoutStatus> {
  const redisTtl = await redis.get(lockKey(email));
  if (redisTtl) {
    const until = new Date(Number(redisTtl));
    if (until.getTime() > Date.now()) return { locked: true, until };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { lockedUntil: true },
  });

  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    // Re-populate Redis so subsequent checks stay on the fast path.
    const ttlSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    await redis.set(lockKey(email), user.lockedUntil.getTime(), 'EX', ttlSeconds);
    return { locked: true, until: user.lockedUntil };
  }

  return { locked: false, until: null };
}

export async function recordFailedAttempt(email: string): Promise<void> {
  const user = await prisma.user.update({
    where: { email },
    data: { failedAttempts: { increment: 1 } },
    select: { failedAttempts: true },
  }).catch(() => null);

  if (!user || user.failedAttempts < MAX_FAILED_ATTEMPTS) return;

  const until = new Date(Date.now() + LOCKOUT_SECONDS * 1000);
  await prisma.user.update({ where: { email }, data: { lockedUntil: until } });
  await redis.set(lockKey(email), until.getTime(), 'EX', LOCKOUT_SECONDS);
}

export async function resetAttempts(email: string): Promise<void> {
  await redis.del(lockKey(email));
  await prisma.user.update({
    where: { email },
    data: { failedAttempts: 0, lockedUntil: null },
  }).catch(() => null);
}
