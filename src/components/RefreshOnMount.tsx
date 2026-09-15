'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Forces a fresh server fetch for the current route on every visit, bypassing
 * Next.js's client-side Router Cache (which can otherwise serve an
 * already-rendered dynamic page for a short window after navigating away and
 * back — see admin/gminas, admin/invites, admin/users, whose gmina picker can
 * go stale relative to gmina CRUD done elsewhere).
 *
 * Scoped per-page on purpose instead of disabling the Router Cache globally
 * (`experimental.staleTimes`), which would add a server round trip to every
 * dynamic-route navigation in the app, not just the pages that need it.
 */
export function RefreshOnMount() {
  const router = useRouter();

  useEffect(() => {
    router.refresh();
    // Only ever meant to run once per mount (i.e. once per navigation to this page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
