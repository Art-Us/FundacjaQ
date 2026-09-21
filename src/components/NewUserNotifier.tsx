'use client';

import { useEffect, useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useAdminEvents } from '@/hooks/useAdminEvents';
import { markNewUser } from '@/lib/newUserNotice';

const TOAST_DURATION_MS = 6000;

/**
 * ADMIN-only (mounted conditionally in ProtectedShell, regardless of which
 * page is open — this is what lets it fire even when the admin isn't
 * currently on an /admin/* page). Reacts to a 'USER_CREATE' AdminEvent
 * (self-service invite acceptance, or another admin creating a user
 * directly) by lighting up the sidebar's red dot (lib/newUserNotice.ts,
 * cleared by admin/users/ClearNewUserNotice.tsx) and showing a brief corner
 * toast. Rides the same already-open SSE connection as everything else in
 * the admin panel — no extra network mechanism, no polling.
 */
export function NewUserNotifier() {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useAdminEvents('users', (event) => {
    if (event.action !== 'USER_CREATE') return;
    markNewUser();
    setVisible(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(false), TOAST_DURATION_MS);
  });

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-md px-4 py-3 shadow-lg"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
        <UserPlus className="h-4 w-4" />
      </div>
      <p className="text-xs font-semibold text-slate-700">W systemie pojawił się nowy użytkownik.</p>
    </div>
  );
}
