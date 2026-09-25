'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppEvents } from '@/hooks/useAppEvents';
import type { ScopeChangeNotice } from '@/lib/scopeChangeNotice';

function formatAssignment(organizationName: string | null, gminaName: string | null): string {
  const org = organizationName ?? 'brak organizacji';
  const gmina = gminaName ?? 'brak przypisanej gminy';
  return `${org} · ${gmina}`;
}

/**
 * Mounted unconditionally in ProtectedShell (every signed-in role — a
 * VOLUNTEER can be the one who's moved, not just staff) — tells a user, in a
 * modal they must explicitly acknowledge, that an admin moved their
 * organization/gmina assignment. Fires no matter HOW that happened (a direct
 * edit, an organization's own gmina reassignment cascading onto its members,
 * or an audit-log revert of either) — every one of those write sites sets
 * User.pendingScopeChangeNotice (see lib/scopeChangeNotice.ts), which is what
 * this polls for.
 *
 * Delivery is belt-and-suspenders: the persisted notice is fetched once on
 * mount (so it's never missed, even if this tab wasn't open at the moment of
 * the change), and a 'user-notice' SSE event (targeted to this user only —
 * see AdminEvent.targetUserId) re-triggers that same fetch for an
 * already-open tab instead of waiting for its next reload.
 */
export function ScopeChangeNoticeModal() {
  const router = useRouter();
  const [notice, setNotice] = useState<ScopeChangeNotice | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotice = useCallback(async () => {
    try {
      const res = await fetch('/api/user/scope-change-notice');
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (data.notice) setNotice(data.notice);
    } catch (err) {
      console.error('[ScopeChangeNoticeModal] failed to load notice:', err);
    }
  }, []);

  useEffect(() => {
    fetchNotice();
  }, [fetchNotice]);

  useAppEvents('user-notice', () => {
    fetchNotice();
  });

  useEffect(() => {
    if (!notice) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [notice]);

  async function handleAcknowledge() {
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch('/api/user/scope-change-notice', { method: 'DELETE' });
      if (!res.ok) {
        setError('Nie udało się zapisać potwierdzenia. Spróbuj ponownie.');
        return;
      }
      setNotice(null);
      // The org/gmina change already took effect server-side (session cache
      // was invalidated at write time — see lib/userStatusCache.ts) — this
      // just makes the CURRENTLY MOUNTED page catch up without a manual
      // reload: router.refresh() re-fetches every server component on this
      // route (the dashboard's stats, /map's or /zasoby's gmina-scoped data,
      // the sidebar's role-derived props in the layout) and clears the
      // Router Cache, so the next navigation elsewhere also fetches fresh
      // instead of serving an already-visited segment from before the move.
      router.refresh();
    } catch (err) {
      console.error('[ScopeChangeNoticeModal] dismiss failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setDismissing(false);
    }
  }

  if (!notice) return null;

  // Deliberately no backdrop-dismiss and no Escape-to-close (unlike every
  // other modal in this app) — this is a one-shot acknowledgement the user
  // must actually read and click through, not a cancelable form.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scope-change-notice-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-3xl bg-white shadow-xl overflow-hidden">
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Building2 className="h-5 w-5" />
            </div>
            <h2 id="scope-change-notice-title" className="text-base font-bold text-slate-900">
              Zmieniono Twoją przynależność
            </h2>
          </div>

          <p className="text-sm text-slate-600">
            Administrator przeniósł Twoje konto do innej organizacji lub gminy. Od teraz widzisz dane przypisane do
            nowego zakresu.
          </p>

          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Poprzednio</span>
            </div>
            <p className="text-slate-700">{formatAssignment(notice.fromOrganizationName, notice.fromGminaName)}</p>
            <div className="flex items-center gap-2 text-slate-400 pt-1">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2 text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Teraz</span>
            </div>
            <p className="text-slate-900 font-medium">{formatAssignment(notice.toOrganizationName, notice.toGminaName)}</p>
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <Button type="button" variant="primary" className="w-full" onClick={handleAcknowledge} disabled={dismissing}>
            {dismissing ? 'Zapisywanie…' : 'Rozumiem'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
