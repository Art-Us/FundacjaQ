import { prisma } from './prisma';
import { redis } from './redis';
import { invalidateUserStatusCache } from './userStatusCache';

const MAX_FAILED_ATTEMPTS = 100; // TEMP: was 20 — revert after [reason/date]
const LOCKOUT_SECONDS = 60 * 60; // 1h

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
 * restart) so a lock can never be silently dropped. A Redis *error* (not just
 * a missing key) is treated the same way — fails open to the Postgres check
 * rather than crashing login entirely on a transient Redis blip.
 */
export async function checkLockout(email: string): Promise<LockoutStatus> {
  let redisTtl: string | null = null;
  try {
    redisTtl = await redis.get(lockKey(email));
  } catch (err) {
    console.error('[lockout] redis.get failed, falling back to Postgres:', err);
  }

  if (redisTtl) {
    const until = new Date(Number(redisTtl));
    if (until.getTime() > Date.now()) return { locked: true, until };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { lockedUntil: true },
  });

  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    // Re-populate Redis so subsequent checks stay on the fast path — best
    // effort only, the lock status above is already determined either way.
    try {
      const ttlSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      await redis.set(lockKey(email), user.lockedUntil.getTime(), 'EX', ttlSeconds);
    } catch (err) {
      console.error('[lockout] failed to repopulate redis cache (non-fatal):', err);
    }
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

  // Best-effort escalation: this is bookkeeping on the "record a failure"
  // path — it must never throw and mask the caller's own intended response
  // (e.g. the "invalid email or password" error in auth.ts).
  try {
    const until = new Date(Date.now() + LOCKOUT_SECONDS * 1000);
    const locked = await prisma.user.update({ where: { email }, data: { lockedUntil: until }, select: { id: true } });
    await redis.set(lockKey(email), until.getTime(), 'EX', LOCKOUT_SECONDS);
    // lockedUntil is one of the fields cached by lib/userStatusCache.ts — an
    // already-active session with a still-fresh "not locked" cache entry
    // would otherwise keep passing the jwt callback's revalidation for up to
    // its TTL even after this lockout takes effect in Postgres.
    await invalidateUserStatusCache(locked.id);
  } catch (err) {
    console.error('[lockout] failed to escalate to a full lockout (non-fatal):', err);
  }
}

/**
 * Returns whether the Postgres counters were actually cleared — existing
 * callers on the login path (auth.ts, reset-password) discard it, since
 * there this must never throw or block an already-authenticated user
 * completing sign-in regardless of the outcome. POST
 * /api/admin/users/[id]/unlock does check it: an admin explicitly asking to
 * lift a lockout needs to know if the write silently failed (DB blip, or the
 * account being deleted concurrently) instead of getting a false "success"
 * and an audit-log entry that doesn't match reality.
 */
export async function resetAttempts(email: string): Promise<boolean> {
  try {
    await redis.del(lockKey(email));
  } catch (err) {
    console.error('[lockout] failed to clear redis lock key (non-fatal):', err);
  }
  const reset = await prisma.user
    .update({
      where: { email },
      data: { failedAttempts: 0, lockedUntil: null },
      select: { id: true },
    })
    .catch(() => null);
  if (reset) await invalidateUserStatusCache(reset.id);
  return reset !== null;
}
