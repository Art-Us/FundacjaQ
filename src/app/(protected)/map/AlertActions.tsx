'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, CheckCircle2, RotateCcw, Trash2 } from 'lucide-react';

interface AlertActionsProps {
  alertId: string;
  status: string;
  kind: string;
  canManage: boolean;
  canDelete: boolean;
}

export default function AlertActions({ alertId, status, kind, canManage, canDelete }: AlertActionsProps) {
  const isEvent = kind === 'EVENT';
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: string, key: string) {
    setLoading(key);
    setError(null);

    const res = await fetch(`/api/alerts/${alertId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });

    const data = await res.json();
    setLoading(null);

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

    setLoading('delete');
    setError(null);

    const res = await fetch(`/api/alerts/${alertId}`, { method: 'DELETE' });
    const data = await res.json();
    setLoading(null);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
  }

  const isActive = status === 'ACTIVE' || status === 'IN_PROGRESS';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canManage && isActive && (
        <>
          <button
            type="button"
            onClick={() => setStatus('RESOLVED', 'resolve')}
            disabled={loading !== null}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>{loading === 'resolve' ? 'Zapisywanie…' : isEvent ? 'Zakończ' : 'Rozwiąż'}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatus('CANCELLED', 'cancel')}
            disabled={loading !== null}
            className="flex-1 min-w-[110px] flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 px-3 shadow-xs tracking-wider uppercase transition transform active:scale-[0.98] disabled:opacity-50"
          >
            {loading === 'cancel' ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Odwoływanie...</span>
              </>
            ) : (
              <>
                <Ban className="h-3.5 w-3.5" />
                <span>Odwołaj</span>
              </>
            )}
          </button>
        </>
      )}

      {canManage && !isActive && (
        <button
          type="button"
          onClick={() => setStatus('ACTIVE', 'reactivate')}
          disabled={loading !== null}
          className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-3 shadow-xs transition transform active:scale-95 disabled:opacity-50"
        >
          {loading === 'reactivate' ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Wznawianie...</span>
            </>
          ) : (
            <>
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{isEvent ? 'Przywróć wydarzenie' : 'Wznów komunikat'}</span>
            </>
          )}
        </button>
      )}

      {canDelete && (
        <button
          type="button"
          onClick={remove}
          disabled={loading !== null}
          className="flex items-center gap-1 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition disabled:opacity-50 shrink-0"
          title="Całkowicie usuń ten alert (tylko Administrator)"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Usuń trwale</span>
        </button>
      )}

      {error && <p className="text-xs text-rose-600 basis-full">{error}</p>}
    </div>
  );
}
