'use client';

import { useEffect } from 'react';
import { useAdminEvents } from '@/hooks/useAdminEvents';
import { clearNewUser } from '@/lib/newUserNotice';

/**
 * Clears the sidebar's "new user" dot (lib/newUserNotice.ts) the moment an
 * admin visits this page — that's them actually seeing the new account. Also
 * keeps clearing it for as long as this page stays mounted: if a fresh
 * 'USER_CREATE' arrives while they're already looking at the (live-updating,
 * see UsersDirectory) list, there's nothing left to notify them about.
 */
export function ClearNewUserNotice() {
  useEffect(() => {
    clearNewUser();
  }, []);

  useAdminEvents('users', (event) => {
    if (event.action === 'USER_CREATE') clearNewUser();
  });

  return null;
}
