import { redis } from './redis';

// Same Redis-fast-path/Postgres-source-of-truth pattern as
// lib/userStatusCache.ts and lib/alertAccessCache.ts. Unlike the alert
// version, a resource's gminaId/organizationId are the ONLY fields
// canManageResource (resources/[id]/route.ts) ever checks, and both are set
// once at creation and never editable afterwards (not in PATCH
// /api/resources/[id]'s update schema) — so a resource's cached access
// snapshot never actually goes stale except when the resource itself is
// deleted, which is why every consumer here uses this purely as a fast
// pre-check that can reject early on a cache hit, never to skip the full
// Postgres read on the allowed path (GET/PATCH/DELETE all need the resource's
// other, genuinely mutable fields — quantity, reservedQuantity, status —
// regardless of authorization). The TTL is a safety net for anything that
// doesn't explicitly invalidate (e.g. a direct DB edit), not the primary
// revocation mechanism.
const TTL_SECONDS = 2 * 60;

export interface CachedResourceAccess {
  gminaId: string;
  organizationId: string | null;
}

function key(resourceId: string): string {
  return `resource-access:${resourceId}`;
}

/** Returns the cached access snapshot, or null on a miss/parse failure/Redis error — callers fall back to Postgres. */
export async function getCachedResourceAccess(resourceId: string): Promise<CachedResourceAccess | null> {
  try {
    const raw = await redis.get(key(resourceId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedResourceAccess;
  } catch (err) {
    console.error('[resourceAccessCache] redis.get failed, falling back to Postgres:', err);
    return null;
  }
}

/** Best-effort — a failed write just means the next request(s) re-hit Postgres, same as a cache miss. */
export async function setCachedResourceAccess(resourceId: string, access: CachedResourceAccess): Promise<void> {
  try {
    await redis.set(key(resourceId), JSON.stringify(access), 'EX', TTL_SECONDS);
  } catch (err) {
    console.error('[resourceAccessCache] redis.set failed (non-fatal):', err);
  }
}

/**
 * Call after deleting a resource, so a stale cache entry doesn't keep
 * reporting it as found (and owned by its former organization) for up to 2
 * minutes. Best-effort: a failed delete just means that one resource rides
 * out the remaining TTL.
 */
export async function invalidateResourceAccessCache(resourceId: string): Promise<void> {
  try {
    await redis.del(key(resourceId));
  } catch (err) {
    console.error('[resourceAccessCache] redis.del failed (non-fatal):', err);
  }
}
