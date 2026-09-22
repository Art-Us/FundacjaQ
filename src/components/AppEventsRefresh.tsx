'use client';

import { useRouter } from 'next/navigation';
import { useAppEvents } from '@/hooks/useAppEvents';
import type { AdminEventScope } from '@/lib/adminEvents';

type AppEventScope = Extract<AdminEventScope, 'alerts' | 'resources'>;

/**
 * For server-rendered alert/resource pages (/map, an alert's detail page,
 * /zasoby) — calls router.refresh() whenever a matching event arrives, the
 * same re-fetch already triggered locally after this page's own mutations.
 * Mirrors components/AdminEventsRefresh.tsx.
 */
export function AppEventsRefresh({ scope }: { scope: AppEventScope | AppEventScope[] }) {
  const router = useRouter();
  useAppEvents(scope, () => router.refresh());
  return null;
}
