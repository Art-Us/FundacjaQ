'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, CheckCircle2, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import CancelWithReturnModal from '@/components/resources/CancelWithReturnModal';
import { apiSend } from '@/lib/apiClient';

interface AlertActionsProps {
  alertId: string;
  alertTitle: string;
  status: string;
  kind: string;
  canManage: boolean;
  canDelete: boolean;
  // R1/R8 — whether the caller's own organization created this alert (as
  // opposed to canManage being true only because they're ADMIN), and how many
  // of its resource allocations are still non-terminal. Together they decide
  // whether "Odwołaj" can PATCH the status directly or must first collect a
  // return decision for each one (CancelWithReturnModal, Крок 48).
  isOwnerOrg: boolean;
  openAllocationCount: number;
}

export default function AlertActions({
  alertId,
  alertTitle,
  status,
  kind,
  canManage,
  canDelete,
  isOwnerOrg,
  openAllocationCount,
}: AlertActionsProps) {
  const isEvent = kind === 'EVENT';
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCancelWithReturn, setShowCancelWithReturn] = useState(false);

  async function setStatus(next: string, key: string) {
    setLoading(key);
    setError(null);

    const result = await apiSend(`/api/alerts/${alertId}`, 'PATCH', { status: next });
    setLoading(null);

    if (!result.ok) {
      setError(result.error);
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

    const result = await apiSend(`/api/alerts/${alertId}`, 'DELETE');
    setLoading(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.refresh();
  }

  const isActive = status === 'ACTIVE' || status === 'IN_PROGRESS';
  // Events have no resource allocations at all, so this never applies to
  // them — only crisis alerts (kind === 'ALERT') go through the resource
  // module. Doesn't apply to an ADMIN cancelling ANOTHER org's alert either
  // (нюанс #5) — that stays the plain direct path PATCH /api/alerts/[id]
  // itself keeps open for that exact case (Крок 29).
  const needsReturnForm = !isEvent && isOwnerOrg && openAllocationCount > 0;

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
            onClick={() => (needsReturnForm ? setShowCancelWithReturn(true) : setStatus('CANCELLED', 'cancel'))}
            disabled={loading !== null}
            className="flex-1 min-w-[110px] flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 px-3 shadow-xs tracking-wider uppercase transition transform active:scale-[0.98] disabled:opacity-50"
          >
            {loading === 'cancel' ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Odwoływanie...</span>
              </>
            ) : needsReturnForm ? (
              <>
                <Undo2 className="h-3.5 w-3.5" />
                <span>Powrót zasobów</span>
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

      {showCancelWithReturn && (
        <CancelWithReturnModal
          alertId={alertId}
          alertTitle={alertTitle}
          onClose={() => setShowCancelWithReturn(false)}
          onCancelled={() => setShowCancelWithReturn(false)}
        />
      )}
    </div>
  );
}
