'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface ToggleUserActiveButtonProps {
  userId: string;
  isActive: boolean;
  /** Called after a successful activate/deactivate so the caller can refetch its own list — this button no longer assumes a server component owns that data. */
  onSuccess?: () => void;
}

export function ToggleUserActiveButton({ userId, isActive, onSuccess }: ToggleUserActiveButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [reason, setReason] = useState('');
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);

  async function callToggle(action: 'activate' | 'deactivate', body?: unknown) {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/users/${userId}/${action}`, {
        method: 'POST',
        ...(body !== undefined && {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Coś poszło nie tak.');
        return;
      }

      setShowReasonInput(false);
      setReason('');
      setShowActivateConfirm(false);
      onSuccess?.();
    } catch (err) {
      console.error('[ToggleUserActiveButton] request failed:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  if (showReasonInput) {
    // basis-full forces this onto its own line inside a flex-wrap row (see
    // UserCard's action row), so the field and buttons span the full card
    // width instead of squeezing next to the neighboring Edytuj button.
    return (
      <div className="w-full basis-full flex flex-col gap-1.5">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Powód dezaktywacji (opcjonalnie)"
          rows={2}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={loading}
            onClick={() => callToggle('deactivate', { reason: reason.trim() || undefined })}
          >
            {loading ? 'Zapisywanie…' : 'Potwierdź dezaktywację'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => {
              setShowReasonInput(false);
              setReason('');
            }}
          >
            Anuluj
          </Button>
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
      </div>
    );
  }

  if (showActivateConfirm) {
    return (
      <div className="w-full basis-full flex flex-col gap-1.5">
        <p className="text-xs text-slate-500">Na pewno aktywować to konto?</p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={loading}
            onClick={() => callToggle('activate')}
          >
            {loading ? 'Zapisywanie…' : 'Potwierdź aktywację'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => setShowActivateConfirm(false)}
          >
            Anuluj
          </Button>
        </div>
        {error && <p className="text-xs text-rose-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={loading}
        onClick={() => (isActive ? setShowReasonInput(true) : setShowActivateConfirm(true))}
      >
        {loading ? 'Zapisywanie…' : isActive ? 'Dezaktywuj' : 'Aktywuj'}
      </Button>
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}
