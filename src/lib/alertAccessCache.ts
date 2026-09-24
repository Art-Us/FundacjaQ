import { redis } from './redis';

// Same Redis-fast-path/Postgres-source-of-truth pattern as
// lib/userStatusCache.ts: a handful of alert sub-resource endpoints
// (needs/allocations/messages — see each route's own comment) fetch the
// parent alert on every single request purely to authorize the action
// (canViewAlertJournal/canPostAlertJournalEntry/isAlertOwnerOrg/the gmina
// gate), not because they need the rest of the alert record. gminaId and
// organizationId are set once at creation and never editable afterwards
// (not in PATCH /api/alerts/[id]'s update schema), so the only field here
// that can ever go stale is `status` — invalidated explicitly at every
// write that changes it (PATCH/DELETE /api/alerts/[id],
// POST /api/alerts/[id]/cancel-with-return). The TTL below is a safety net
// for anything that doesn't (e.g. a direct DB edit), not the primary
// revocation mechanism.
const TTL_SECONDS = 2 * 60;

export interface CachedAlertAccess {
  gminaId: string;
  organizationId: string | null;
  status: string;
}

function key(alertId: string): string {
  return `alert-access:${alertId}`;
}

/** Returns the cached access snapshot, or null on a miss/parse failure/Redis error — callers fall back to Postgres. */
export async function getCachedAlertAccess(alertId: string): Promise<CachedAlertAccess | null> {
  try {
    const raw = await redis.get(key(alertId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedAlertAccess;
  } catch (err) {
    console.error('[alertAccessCache] redis.get failed, falling back to Postgres:', err);
    return null;
  }
}

/** Best-effort — a failed write just means the next request(s) re-hit Postgres, same as a cache miss. */
export async function setCachedAlertAccess(alertId: string, access: CachedAlertAccess): Promise<void> {
  try {
    await redis.set(key(alertId), JSON.stringify(access), 'EX', TTL_SECONDS);
  } catch (err) {
    console.error('[alertAccessCache] redis.set failed (non-fatal):', err);
  }
}

/**
 * Call after any write that changes an alert's status, or deletes it, so the
 * change takes effect on the very next request instead of waiting out the
 * TTL — deletion matters most: a stale cache entry for a since-deleted alert
 * would otherwise keep reporting it as found for up to 2 minutes. Best-effort:
 * a failed delete just means that one alert rides out the remaining TTL.
 */
export async function invalidateAlertAccessCache(alertId: string): Promise<void> {
  try {
    await redis.del(key(alertId));
  } catch (err) {
    console.error('[alertAccessCache] redis.del failed (non-fatal):', err);
  }
}
