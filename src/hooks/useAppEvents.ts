'use client';

import { useEffect, useRef } from 'react';
import type { AdminEvent, AdminEventScope } from '@/lib/adminEvents';

type AppEventScope = Extract<AdminEventScope, 'alerts' | 'resources' | 'alert-messages' | 'user-notice'>;

interface UseAppEventsOptions {
  // When set, an event tagged with a DIFFERENT gminaId is silently ignored —
  // pass the viewer's own gminaId for a gmina-scoped role (COORDINATOR,
  // VOLUNTEER, or a gmina-scoped ADMIN), or omit it entirely for a viewer
  // who should react to every gmina's activity (a global ADMIN). An event
  // published with NO gminaId at all (the publisher couldn't safely narrow
  // it to one gmina — see adminEvents.ts's doc comment) always passes this
  // filter regardless, so it only ever under-narrows, never drops something
  // a caller needed.
  gminaId?: string | null;
}

/**
 * Runs `onEvent` whenever an 'alerts'/'resources'/'alert-messages'/'user-notice'
 * change of `scope` (or, given an array, any of them) arrives over the shared SSE
 * connection — see components/AppEventsBridge.tsx (mounted once in ProtectedShell for every
 * signed-in user), which re-dispatches server events as a window CustomEvent
 * so each page can subscribe independently without opening its own
 * EventSource. Mirrors hooks/useAdminEvents.ts, just off the broader
 * 'app-event' CustomEvent a VOLUNTEER also receives.
 */
export function useAppEvents(
  scope: AppEventScope | AppEventScope[],
  onEvent: (event: AdminEvent) => void,
  options?: UseAppEventsOptions
) {
  // Ref so a freshly-recreated (unmemoized) onEvent each render doesn't force
  // the listener to be torn down and re-added every render — only `scopeKey`
  // below (derived from `scope`, stable across re-renders unless the actual
  // set of scopes changes) does that.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const scopes = Array.isArray(scope) ? scope : [scope];
  const scopeKey = scopes.join(',');
  const gminaFilter = options?.gminaId;

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent<AdminEvent>).detail;
      if (!detail || !scopeKey.split(',').includes(detail.scope)) return;
      if (gminaFilter !== undefined && detail.gminaId && detail.gminaId !== gminaFilter) return;
      onEventRef.current(detail);
    }
    window.addEventListener('app-event', handle);
    return () => window.removeEventListener('app-event', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, gminaFilter]);
}
