'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, AlertTriangle, Ban } from 'lucide-react';
import AllocationStatusBadge from './AllocationStatusBadge';

interface CancelableAllocation {
  id: string;
  itemName: string;
  unit: string;
  quantity: number;
  quantityReturned: number;
  quantityNotReturnable: number;
  status: string;
  donorOrg: { id: string; name: string };
}

interface ReturnDraft {
  quantityReturned: string;
  quantityNotReturnable: string;
  notReturnableReason: string;
  message: string;
  returnedAt: string;
}

interface CancelWithReturnModalProps {
  alertId: string;
  alertTitle: string;
  onClose: () => void;
  onCancelled?: () => void;
}

function nowForDatetimeLocal(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function emptyDraft(): ReturnDraft {
  return {
    quantityReturned: '',
    quantityNotReturnable: '',
    notReturnableReason: '',
    message: '',
    returnedAt: nowForDatetimeLocal(),
  };
}

// R8 — the OWNER organization cancelling its own alert must settle every
// resource it actually received (DELIVERED/RETURN_AGREED/PARTIALLY_RETURNED)
// right here, in one batch, rather than leaving it for the /zasoby inbox
// (Крок 27) afterwards — that path stays reserved for an ADMIN cancelling
// ANOTHER org's alert (нюанс #5, PATCH /api/alerts/[id] still handles that
// case directly). Allocations still awaiting delivery (DELIVERY_AGREED) never
// reached the recipient, so the API withdraws those automatically — nothing
// to decide, just shown here for transparency. POSTs the whole batch to
// /api/alerts/[id]/cancel-with-return (Крок 28), which re-validates
// "every delivered allocation has a decision" server-side; this form just
// can't be submitted without one, so that 409 never actually fires for
// submissions made through it.
export default function CancelWithReturnModal({ alertId, alertTitle, onClose, onCancelled }: CancelWithReturnModalProps) {
  const router = useRouter();
  const [allocations, setAllocations] = useState<CancelableAllocation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReturnDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/alerts/${alertId}/allocations`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('request failed'))))
      .then((data) => {
        const all: CancelableAllocation[] = data.allocations ?? [];
        const nonTerminal = all.filter((a) => a.status !== 'RETURNED' && a.status !== 'CANCELLED');
        setAllocations(nonTerminal);
        setDrafts(
          Object.fromEntries(nonTerminal.filter((a) => a.status !== 'DELIVERY_AGREED').map((a) => [a.id, emptyDraft()]))
        );
      })
      .catch(() => setLoadError('Nie udało się pobrać przydziałów tego alertu.'));
  }, [alertId]);

  // Never reached the recipient — the API withdraws these on its own, no
  // return decision makes sense for a resource that was never received.
  const delivered = useMemo(() => (allocations ?? []).filter((a) => a.status !== 'DELIVERY_AGREED'), [allocations]);
  const undelivered = useMemo(() => (allocations ?? []).filter((a) => a.status === 'DELIVERY_AGREED'), [allocations]);

  function updateDraft(id: string, patch: Partial<ReturnDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function remainingFor(allocation: CancelableAllocation): number {
    return allocation.quantity - allocation.quantityReturned - allocation.quantityNotReturnable;
  }

  function isDraftValid(allocation: CancelableAllocation): boolean {
    const draft = drafts[allocation.id];
    if (!draft) return false;
    const returnedNum = Number(draft.quantityReturned) || 0;
    const notReturnableNum = Number(draft.quantityNotReturnable) || 0;
    const sum = returnedNum + notReturnableNum;
    return (
      Number.isInteger(returnedNum) &&
      Number.isInteger(notReturnableNum) &&
      returnedNum >= 0 &&
      notReturnableNum >= 0 &&
      sum > 0 &&
      sum <= remainingFor(allocation) &&
      !!draft.returnedAt
    );
  }

  const canSubmit = allocations !== null && delivered.every(isDraftValid);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    const res = await fetch(`/api/alerts/${alertId}/cancel-with-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        returns: delivered.map((a) => {
          const draft = drafts[a.id];
          const notReturnableNum = Number(draft.quantityNotReturnable) || 0;
          return {
            allocationId: a.id,
            quantityReturned: Number(draft.quantityReturned) || 0,
            quantityNotReturnable: notReturnableNum,
            notReturnableReason: notReturnableNum > 0 ? draft.notReturnableReason.trim() || undefined : undefined,
            message: draft.message.trim() || undefined,
            returnedAt: new Date(draft.returnedAt).toISOString(),
          };
        }),
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
    onCancelled?.();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Odwołaj alert ze zwrotem zasobów</h3>
            <p className="text-xs text-slate-500 mt-0.5">{alertTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loadError && <p className="text-xs text-rose-600 py-6 text-center">{loadError}</p>}
        {!loadError && allocations === null && (
          <p className="text-xs text-slate-500 py-6 text-center">Ładowanie przydziałów…</p>
        )}

        {!loadError && allocations !== null && (
          <form onSubmit={handleSubmit} className="space-y-5">
            {delivered.length === 0 && undelivered.length === 0 && (
              <p className="text-xs text-slate-500">
                Ten alert nie ma żadnych aktywnych przydziałów zasobów — można go bezpiecznie odwołać.
              </p>
            )}

            {delivered.length > 0 && (
              <div className="space-y-3">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  Wymagana decyzja o zwrocie ({delivered.length})
                </p>
                <div className="space-y-4">
                  {delivered.map((allocation) => {
                    const draft = drafts[allocation.id] ?? emptyDraft();
                    const remaining = remainingFor(allocation);
                    const returnedNum = Number(draft.quantityReturned) || 0;
                    const notReturnableNum = Number(draft.quantityNotReturnable) || 0;
                    return (
                      <div key={allocation.id} className="rounded-2xl border border-slate-200 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{allocation.itemName}</p>
                            <p className="text-xs text-slate-500">
                              {allocation.donorOrg.name} · pozostało do rozliczenia {remaining} {allocation.unit}
                            </p>
                          </div>
                          <AllocationStatusBadge status={allocation.status} className="shrink-0" />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              Zwrócono
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              max={remaining}
                              value={draft.quantityReturned}
                              onChange={(e) => updateDraft(allocation.id, { quantityReturned: e.target.value })}
                              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              Nie podlega zwrotowi
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              max={remaining}
                              value={draft.quantityNotReturnable}
                              onChange={(e) => updateDraft(allocation.id, { quantityNotReturnable: e.target.value })}
                              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        </div>

                        {returnedNum + notReturnableNum > remaining && (
                          <p className="text-[11px] text-rose-600">Suma przekracza ilość pozostałą do rozliczenia.</p>
                        )}

                        {notReturnableNum > 0 && (
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              Powód (opcjonalnie)
                            </label>
                            <input
                              type="text"
                              value={draft.notReturnableReason}
                              onChange={(e) => updateDraft(allocation.id, { notReturnableReason: e.target.value })}
                              placeholder="np. uszkodzone, zużyte"
                              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              Data i godzina zwrotu
                            </label>
                            <input
                              type="datetime-local"
                              required
                              value={draft.returnedAt}
                              onChange={(e) => updateDraft(allocation.id, { returnedAt: e.target.value })}
                              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              Wiadomość (opcjonalnie)
                            </label>
                            <input
                              type="text"
                              value={draft.message}
                              onChange={(e) => updateDraft(allocation.id, { message: e.target.value })}
                              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {undelivered.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Ban className="h-3.5 w-3.5 text-slate-400" />
                  Zostaną automatycznie anulowane ({undelivered.length})
                </p>
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
                  {undelivered.map((allocation) => (
                    <li key={allocation.id} className="py-2.5 px-4 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{allocation.itemName}</p>
                        <p className="text-[11px] text-slate-500">{allocation.donorOrg.name} · nie dostarczono</p>
                      </div>
                      <AllocationStatusBadge status={allocation.status} className="shrink-0" />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="text-xs text-rose-600">{error}</p>}

            <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
              >
                Anuluj
              </button>
              <button
                type="submit"
                disabled={submitting || !canSubmit}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm shadow-red-600/25 transition disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Odwoływanie...</span>
                  </>
                ) : (
                  <span>Odwołaj alert</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
