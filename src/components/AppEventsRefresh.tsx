'use client';

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

/**
 * For server-rendered alert/resource pages (/map, an alert's detail page,
 * /zasoby) — calls router.refresh() whenever a matching event arrives, the
 * same re-fetch already triggered locally after this page's own mutations.
 * Mirrors components/AdminEventsRefresh.tsx.
 */
export function AppEventsRefresh({ scope, gminaId }: AppEventsRefreshProps) {
  const router = useRouter();
  useAppEvents(scope, () => router.refresh(), { gminaId });
  return null;
}
