'use client';

import { useEffect } from 'react';
import type { AdminEvent } from '@/lib/adminEvents';
import { registerSseConnection } from '@/lib/sseClientRegistry';

/**
 * Mounted once in ProtectedShell for EVERY signed-in user (unlike
 * AdminEventsBridge, gated to ADMIN/COORDINATOR) — the single SSE connection
 * behind the 'alerts'/'resources' live-refresh on /map, an alert's detail
 * page, and /zasoby. Re-dispatches each server event as a window CustomEvent
 * so individual pages subscribe via hooks/useAppEvents without needing a
 * React context of their own.
 *
 * The browser's native EventSource reconnects automatically on drop (with a
 * built-in backoff) — no manual retry logic needed here.
 */
export function AppEventsBridge() {
  useEffect(() => {
    const source = new EventSource('/api/events');
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
      window.dispatchEvent(new CustomEvent('app-event', { detail: event }));
    };
    source.onerror = () => {
      // A non-200 response (403 — session revoked mid-session) permanently
      // closes the connection: readyState CLOSED, no browser retry (per spec,
      // an HTTP-level failure "fails the connection" rather than scheduling a
      // reconnect). A transient network drop instead leaves readyState
      // CONNECTING while the browser retries on its own, so only the
      // permanent case is worth logging — otherwise this would fire on every
      // ordinary reconnect blip.
      if (source.readyState === EventSource.CLOSED) {
        console.error('[AppEventsBridge] SSE connection closed permanently (likely session change)');
      }
    };
    return () => {
      unregister();
      source.close();
    };
  }, []);

  return null;
}
