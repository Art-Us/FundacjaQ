'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AlertActionsProps {
  alertId: string;
  status: string;
  canDelete: boolean;
}

export default function AlertActions({ alertId, status, canDelete }: AlertActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/alerts/${alertId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVED' }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
  }

  async function remove() {
    if (!window.confirm('Czy na pewno trwale usunąć ten alert? Tej operacji nie można cofnąć.')) {
      return;
    }

    setLoading(true);
    setError(null);

    const res = await fetch(`/api/alerts/${alertId}`, { method: 'DELETE' });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(status === 'ACTIVE' || status === 'IN_PROGRESS') && (
        <button
          type="button"
          onClick={resolve}
          disabled={loading}
          className="text-xs rounded-full border border-emerald-800 bg-emerald-950/60 text-emerald-300 px-2.5 py-1 disabled:opacity-50 disabled:pointer-events-none"
        >
          {loading ? '…' : 'Oznacz jako rozwiązany'}
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={remove}
          disabled={loading}
          className="text-xs rounded-full border border-rose-800 bg-rose-950/60 text-rose-300 px-2.5 py-1 disabled:opacity-50 disabled:pointer-events-none"
        >
          {loading ? '…' : 'Usuń'}
        </button>
      )}
      {error && <p className="text-xs text-rose-400 basis-full">{error}</p>}
    </div>
  );
}
