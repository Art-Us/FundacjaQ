'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackdropDismiss } from '@/components/ui/useBackdropDismiss';

export type InviteStatus = 'Aktywne' | 'Wykorzystane' | 'Unieważnione' | 'Wygasłe';

interface ToggleInviteButtonProps {
  inviteId: string;
  status: InviteStatus;
}

/**
 * Mirrors ToggleUserActiveButton's activate/deactivate pairing, but for
 * invites: "Dezaktywuj" revokes an active invite, "Aktywuj" reissues a
 * revoked/expired one with a brand-new link (see POST
 * /api/admin/invites/[id]/reactivate — the original raw token was never
 * stored, so it can't simply be un-revoked back into a working link). A used
 * invite has nothing left to toggle.
 */
export function ToggleInviteButton({ inviteId, status }: ToggleInviteButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const backdropHandlers = useBackdropDismiss(() => setInviteUrl(null));

  if (status === 'Wykorzystane') return null;

  const action = status === 'Aktywne' ? 'revoke' : 'reactivate';

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/invites/${inviteId}/${action}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      if (action === 'reactivate' && data.inviteUrl) {
        setInviteUrl(data.inviteUrl);
        setCopied(false);
      }
      router.refresh();
    } catch (err) {
      console.error('[ToggleInviteButton] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={handleClick}>
        {loading ? 'Zapisywanie…' : action === 'revoke' ? 'Dezaktywuj' : 'Aktywuj'}
      </Button>
      {error && <p className="text-xs text-rose-500 max-w-[10rem] text-right">{error}</p>}
      {/* Portaled, not rendered inline — this table's actions column is only
          a few rem wide, and the invite link is much longer than that. An
          inline box wide enough to hold it would force the whole column
          (and every other row's) wider than the card, spilling the table
          into an unwanted horizontal scroll. A centered modal has no such
          constraint. */}
      {inviteUrl &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reactivate-invite-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
            {...backdropHandlers}
          >
            <div className="w-full max-w-md rounded-3xl bg-white shadow-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 id="reactivate-invite-title" className="text-base font-bold text-slate-900">
                  Nowy link zaproszenia
                </h2>
                <button
                  type="button"
                  onClick={() => setInviteUrl(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                  aria-label="Zamknij"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Zaproszenie zostało wznowione. Przekaż ten link zapraszanej osobie:
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  autoFocus
                  value={inviteUrl}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 focus:outline-none"
                />
                <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
                  {copied ? 'Skopiowano!' : 'Kopiuj'}
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
