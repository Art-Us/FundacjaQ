import { redis } from './redis';

// Backs the jwt callback's per-request revalidation query in auth.ts. Redis is
// the fast path so a valid session doesn't pay for a Postgres round trip on
// every single page/API request; the TTL below is a safety net for the case
// where an entry is never explicitly invalidated (e.g. a direct DB edit
// bypassing the app), NOT the primary revocation mechanism — that's the
// explicit invalidateUserStatusCache() calls at every write site (activate/
// deactivate/PATCH/DELETE users, reset-password, audit-log revert). Mirrors
// the Redis-fast-path/Postgres-source-of-truth pattern in lib/lockout.ts.
const TTL_SECONDS = 2 * 60;

export interface CachedUserStatus {
  isActive: boolean;
  lockedUntil: string | null; // ISO string, or null
  passwordChangedAt: string; // ISO string
  role: string;
  gminaId: string | null;
  organizationId: string | null;
}

function key(userId: string): string {
  return `user-status:${userId}`;
}

/** Returns the cached status, or null on a miss/parse failure/Redis error — callers fall back to Postgres. */
export async function getCachedUserStatus(userId: string): Promise<CachedUserStatus | null> {
  try {
    const raw = await redis.get(key(userId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedUserStatus;
  } catch (err) {
    console.error('[userStatusCache] redis.get failed, falling back to Postgres:', err);
    return null;
  }
}

/** Best-effort — a failed write just means the next request(s) re-hit Postgres, same as a cache miss. */
export async function setCachedUserStatus(userId: string, status: CachedUserStatus): Promise<void> {
  try {
    await redis.set(key(userId), JSON.stringify(status), 'EX', TTL_SECONDS);
  } catch (err) {
    console.error('[userStatusCache] redis.set failed (non-fatal):', err);
  }
}

/**
 * Call after any write that changes isActive/lockedUntil/passwordChangedAt/
 * role/gminaId/organizationId (or deletes the user) so the change takes
 * effect on this user's very next request instead of waiting out the TTL.
 * Best-effort: a failed delete just means that one user rides out the
 * remaining TTL (at most 2 minutes) before Postgres is consulted again.
 */
export async function invalidateUserStatusCache(userId: string): Promise<void> {
  try {
    await redis.del(key(userId));
  } catch (err) {
    console.error('[userStatusCache] redis.del failed (non-fatal):', err);
  }
}
