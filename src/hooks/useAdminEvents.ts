'use client';

import { useEffect, useRef } from 'react';
import type { AdminEvent, AdminEventScope } from '@/lib/adminEvents';

/**
 * Runs `onEvent` whenever an admin-panel change of `scope` (or, given an
 * array, any of several scopes — e.g. the invites page cares about its own
 * 'invites' list AND the 'gminas' picker it renders) arrives over the shared
 * SSE connection — see components/AdminEventsBridge.tsx (mounted once in
 * admin/layout.tsx), which re-dispatches server events as a window
 * CustomEvent so each page can subscribe independently without opening its
 * own EventSource. `onEvent` receives the full event (not just a "something
 * changed" signal) — most callers ignore it and just re-fetch, but one that
 * cares which action caused it (e.g. NewUserNotifier, which only reacts to
 * 'USER_CREATE' and ignores every other 'users'-scope change) can inspect it.
 */
export function useAdminEvents(scope: AdminEventScope | AdminEventScope[], onEvent: (event: AdminEvent) => void) {
  // Ref so a freshly-recreated (unmemoized) onEvent each render doesn't force
  // the listener to be torn down and re-added every render — only `scopeKey`
  // below (derived from `scope`, stable across re-renders unless the actual
  // set of scopes changes) does that.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const scopes = Array.isArray(scope) ? scope : [scope];
  const scopeKey = scopes.join(',');

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent<AdminEvent>).detail;
      if (detail && scopeKey.split(',').includes(detail.scope)) onEventRef.current(detail);
    }
    window.addEventListener('admin-event', handle);
    return () => window.removeEventListener('admin-event', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
}
