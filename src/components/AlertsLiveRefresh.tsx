'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminEvent } from '@/lib/adminEvents';

// Several changes usually land together (an alert plus its needs, a
// cancel-with-return touching many allocations) — one refresh for the whole
// burst instead of one per event.
const DEBOUNCE_MS = 1_000;
// Safety net for anything the SSE stream can miss (a dropped connection
// that hasn't reconnected yet, a failed Redis publish): a visible tab never
// shows alerts more than this much out of date.
const POLL_MS = 60_000;

/**
 * Keeps a server-rendered alerts view (map, dashboard, alert details) in step
 * with changes made by other users, without a manual reload. Mounted by those
 * pages only; re-fetches via router.refresh(), which re-renders the page on
 * the server and keeps all client state (filters, open modals, map position).
 *
 * Refreshes on:
 *  - an alert-change event from /api/events (lib/alertEvents.ts) — for any
 *    alert, or only `alertId`'s when given (the details page),
 *  - the SSE connection re-opening after a drop (events may have been missed),
 *  - the tab becoming visible again (phones suspend background tabs and
 *    home-screen apps for hours),
 *  - every POLL_MS while visible, as a last-resort fallback.
 */
export function AlertsLiveRefresh({ alertId }: { alertId?: string }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => routerRef.current.refresh(), DEBOUNCE_MS);
    };

    const source = new EventSource('/api/events');
    let hadError = false;
    source.onopen = () => {
      if (hadError) refresh();
      hadError = false;
    };
    source.onerror = () => {
      hadError = true;
    };
    source.onmessage = (e) => {
      let event: AdminEvent;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event.scope !== 'alerts') return;
      if (alertId && event.alertId !== alertId) return;
      refresh();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);

    return () => {
      source.close();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(poll);
      clearTimeout(debounce);
    };
  }, [alertId]);

  return null;
}
