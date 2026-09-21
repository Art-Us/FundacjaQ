/**
 * Whether a new pending user has appeared since an ADMIN last visited
 * admin/users — drives the red dot on the sidebar's "Użytkownicy" link
 * (components/layout/Sidebar.tsx). Plain module-level store (not React
 * state) so it survives navigation across the whole app, same reasoning as
 * lib/adminListCache.ts; components read it reactively via
 * hooks/useHasNewUser.ts's useSyncExternalStore.
 *
 * Set by components/NewUserNotifier.tsx (mounted once, ADMIN-only, in
 * ProtectedShell) on a 'USER_CREATE' AdminEvent; cleared by
 * admin/users/ClearNewUserNotice.tsx the moment that page is visited (or,
 * if it's already open when the event arrives, immediately again).
 */
type Listener = () => void;

let hasNew = false;
const listeners = new Set<Listener>();

export function getHasNewUser(): boolean {
  return hasNew;
}

export function markNewUser(): void {
  if (hasNew) return;
  hasNew = true;
  listeners.forEach((listener) => listener());
}

export function clearNewUser(): void {
  if (!hasNew) return;
  hasNew = false;
  listeners.forEach((listener) => listener());
}

export function subscribeNewUser(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
