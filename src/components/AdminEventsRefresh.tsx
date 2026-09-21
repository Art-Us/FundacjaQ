'use client';

import { useRouter } from 'next/navigation';
import { useAdminEvents } from '@/hooks/useAdminEvents';
import type { AdminEventScope } from '@/lib/adminEvents';

/**
 * For admin pages with server-rendered data (e.g. admin/invites' list, or
 * admin/users' gmina/organization picker props) rather than client-fetched —
 * calls router.refresh() whenever a matching AdminEvent arrives, the same
 * re-fetch already triggered locally after this page's own mutations (see
 * ToggleInviteButton/CreateInviteForm).
 */
export function AdminEventsRefresh({ scope }: { scope: AdminEventScope | AdminEventScope[] }) {
  const router = useRouter();
  useAdminEvents(scope, () => router.refresh());
  return null;
}
