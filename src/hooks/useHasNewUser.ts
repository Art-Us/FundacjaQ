'use client';

import { useSyncExternalStore } from 'react';
import { getHasNewUser, subscribeNewUser } from '@/lib/newUserNotice';

/** Reactive read of lib/newUserNotice.ts's flag — false on the server (there's nothing to be stale relative to before hydration). */
export function useHasNewUser(): boolean {
  return useSyncExternalStore(subscribeNewUser, getHasNewUser, () => false);
}
