'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppEvents } from '@/hooks/useAppEvents';
import type { AdminEventScope } from '@/lib/adminEvents';

type AppEventScope = Extract<AdminEventScope, 'alerts' | 'resources'>;

interface AppEventsRefreshProps {
  scope: AppEventScope | AppEventScope[];
  // The viewer's own gminaId — omit for a viewer who should refresh on
  // every gmina's activity (a global ADMIN); pass it for a gmina-scoped one
  // (COORDINATOR, VOLUNTEER, or a gmina-scoped ADMIN) so another gmina's
  // alert/resource change doesn't refetch a list they can't even see into.
  // See useAppEvents's own doc comment for the exact filter semantics.
  gminaId?: string | null;
}

// Every open /map or /zasoby (this event's scope) reacts to the SAME
// published event at the same instant — with many concurrent operators
// (e.g. everyone watching a live incident), that's every one of them
// calling router.refresh() within the same tens-of-milliseconds window,
// each a full server render that hits Postgres 2-3 times (map/page.tsx:
// alert/gmina/resource findMany). With a modest connection_limit
// (.env.example), a burst that size can exhaust the pool and hand
// PrismaClientInitializationError 500s to every one of those operators —
// exactly the incident this smooths out: spreading the refresh over a
// random window turns one sharp spike into a trickle, and coalescing any
// further events that land inside that window into the one already-
// scheduled refresh keeps a fast burst of events from scheduling a pile of
// separate ones. Client-only, no server change needed.
const JITTER_MAX_MS = 4000;

/**
 * For server-rendered alert/resource pages (/map, an alert's detail page,
 * /zasoby) — calls router.refresh() whenever a matching event arrives, the
 * same re-fetch already triggered locally after this page's own mutations.
 * Mirrors components/AdminEventsRefresh.tsx.
 */
export function AppEventsRefresh({ scope, gminaId }: AppEventsRefreshProps) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useAppEvents(
    scope,
    () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, Math.random() * JITTER_MAX_MS);
    },
    { gminaId }
  );

  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  return null;
}
