'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function ToggleUserActiveButton({ userId, isActive }: { userId: string; isActive: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [reason, setReason] = useState('');

  async function callToggle(action: 'activate' | 'deactivate', body?: unknown) {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/admin/users/${userId}/${action}`, {
      method: 'POST',
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    const data = await res.json();

    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    setShowReasonInput(false);
    setReason('');
    router.refresh();
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

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={loading}
        onClick={() => (isActive ? setShowReasonInput(true) : callToggle('activate'))}
      >
        {loading ? 'Zapisywanie…' : isActive ? 'Dezaktywuj' : 'Aktywuj'}
      </Button>
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}
