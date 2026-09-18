'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

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
    <div className="flex flex-col items-end gap-1.5">
      <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={handleClick}>
        {loading ? 'Zapisywanie…' : action === 'revoke' ? 'Dezaktywuj' : 'Aktywuj'}
      </Button>
      {error && <p className="text-xs text-rose-500">{error}</p>}
      {inviteUrl && (
        <div className="w-64 rounded-xl border border-slate-200 bg-slate-50 p-2 text-left">
          <p className="text-[10px] text-slate-500 mb-1.5">Nowy link zaproszenia:</p>
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 rounded-lg bg-white border border-slate-200 px-2 py-1 text-[11px] text-slate-600 focus:outline-none"
            />
            <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? 'Skopiowano!' : 'Kopiuj'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
