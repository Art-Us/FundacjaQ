import type { AdminEventScope } from './adminEvents';

/**
 * Per-tab, in-memory cache of each admin directory's last-fetched list
 * result, keyed by the exact query string it was fetched with — so a fresh
 * mount (e.g. navigating back to a page you just left) can render instantly
 * from what's already known instead of re-hitting the API for data nothing
 * has actually changed. Cleared on a full page reload; that's fine, a cold
 * load was always going to fetch anyway.
 *
 * One slot per scope, not a full key->entry map: the slot just remembers
 * which query it holds, so a mismatched key (e.g. the cached entry is a
 * filtered view, but the page just mounted with default filters) is a plain
 * cache miss rather than serving the wrong data.
 *
 * Invalidated from one place — AdminEventsBridge, the instant a matching
 * AdminEvent arrives — so this can never serve data older than the last
 * real change; it only skips fetches that would have returned the exact
 * same thing anyway.
 */
interface CacheSlot {
  key: string;
  data: unknown;
  fresh: boolean;
}

const cache = new Map<AdminEventScope, CacheSlot>();

export function getCachedList<T>(scope: AdminEventScope, key: string): T | undefined {
  const slot = cache.get(scope);
  return slot && slot.fresh && slot.key === key ? (slot.data as T) : undefined;
}

export function setCachedList(scope: AdminEventScope, key: string, data: unknown): void {
  cache.set(scope, { key, data, fresh: true });
}

/** Called from AdminEventsBridge on every incoming AdminEvent — never called directly by a page. */
export function invalidateCachedList(scope: AdminEventScope): void {
  const slot = cache.get(scope);
  if (slot) slot.fresh = false;
}
