'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminEvents } from '@/hooks/useAdminEvents';
import type { AdminEventScope } from '@/lib/adminEvents';

// Same thundering-herd concern as components/AppEventsRefresh.tsx's own
// comment (every open admin tab reacting to one event at the same instant)
// — smaller blast radius here (ADMIN/COORDINATOR only, not every signed-in
// user), but cheap enough to apply uniformly rather than special-case it.
const JITTER_MAX_MS = 4000;

/**
 * For admin pages with server-rendered data (e.g. admin/invites' list, or
 * admin/users' gmina/organization picker props) rather than client-fetched —
 * calls router.refresh() whenever a matching AdminEvent arrives, the same
 * re-fetch already triggered locally after this page's own mutations (see
 * ToggleInviteButton/CreateInviteForm).
 */
export function AdminEventsRefresh({ scope }: { scope: AdminEventScope | AdminEventScope[] }) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useAdminEvents(scope, () => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      router.refresh();
    }, Math.random() * JITTER_MAX_MS);
  });

  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  return null;
}
