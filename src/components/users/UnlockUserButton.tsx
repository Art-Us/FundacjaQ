'use client';

import { useState } from 'react';
import { LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UnlockUserButtonProps {
  userId: string;
  /** Called after a successful unlock so the caller can refetch its own list. */
  onSuccess?: () => void;
}

export function UnlockUserButton({ userId, onSuccess }: UnlockUserButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/users/${userId}/unlock`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      setConfirming(false);
      onSuccess?.();
    } catch (err) {
      console.error('[UnlockUserButton] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      // flex-1 (not items-start's natural width): when this ends up sharing
      // its flex-wrap row with siblings (Edytuj/Dezaktywuj in UserCard) it
      // grows alongside them same as before, but when it wraps onto a line
      // of its own — the common case — it now claims that whole line instead
      // of leaving dead space next to a left-aligned pair of small buttons.
      <div className="flex-1 min-w-[180px] flex flex-col items-start gap-1">
        <div className="flex items-center gap-2 w-full">
          <Button type="button" variant="danger" size="sm" className="flex-1" disabled={loading} onClick={handleUnlock}>
            {loading ? 'Odblokowywanie…' : 'Tak, odblokuj konto'}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => setConfirming(false)}>
            Anuluj
          </Button>
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-[180px] flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full gap-1.5"
        disabled={loading}
        onClick={() => setConfirming(true)}
      >
        <LockOpen className="h-3.5 w-3.5" />
        Odblokuj konto
      </Button>
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}
