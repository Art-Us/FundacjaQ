'use client';

import { useEffect } from 'react';
import type { AdminEvent } from '@/lib/adminEvents';
import { invalidateCachedList } from '@/lib/adminListCache';
import { registerSseConnection } from '@/lib/sseClientRegistry';

/**
 * Mounted once in admin/layout.tsx — the single SSE connection for the whole
 * admin panel (users/invites/logs share it rather than each opening their
 * own). Re-dispatches each server event as a window CustomEvent so
 * individual pages subscribe via hooks/useAdminEvents without needing a
 * React context of their own.
 *
 * The browser's native EventSource reconnects automatically on drop (with a
 * built-in backoff) — no manual retry logic needed here.
 */
export function AdminEventsBridge() {
  useEffect(() => {
    const source = new EventSource('/api/admin/events');
    // See sseClientRegistry.ts's doc comment — lets signOut() force this
    // closed before it navigates, instead of relying on this effect's own
    // cleanup (below) running in time.
    const unregister = registerSseConnection(source);
    source.onmessage = (e) => {
      let event: AdminEvent;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      invalidateCachedList(event.scope);
      window.dispatchEvent(new CustomEvent('admin-event', { detail: event }));
    };
    source.onerror = () => {
      // A non-200 response (403 — session revoked, or role changed away from
      // admin/coordinator mid-session) permanently closes the connection:
      // readyState CLOSED, no browser retry (per spec, an HTTP-level failure
      // "fails the connection" rather than scheduling a reconnect). A
      // transient network drop instead leaves readyState CONNECTING while
      // the browser retries on its own, so only the permanent case is worth
      // logging — otherwise this would fire on every ordinary reconnect blip.
      if (source.readyState === EventSource.CLOSED) {
        console.error('[AdminEventsBridge] SSE connection closed permanently (likely session/role change)');
      }
    };
    return () => {
      unregister();
      source.close();
    };
  }, []);

  return null;
}
