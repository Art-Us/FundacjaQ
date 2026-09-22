'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Undo2 } from 'lucide-react';
import AllocationStatusBadge from './AllocationStatusBadge';
import { apiSend } from '@/lib/apiClient';

interface ReturnResourcesModalProps {
  allocationId: string;
  itemName: string;
  unit: string;
  quantity: number;
  quantityReturned: number;
  quantityNotReturnable: number;
  status: string;
  alertTitle: string;
  onClose: () => void;
  onReturned?: () => void;
}

function nowForDatetimeLocal(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

// "Zwróć zasoby" (R4+R5+R9) — a single form for the RECIPIENT to record a
// (partial) return: how much came back, how much is written off as
// not-returnable (+reason), an optional note, and the return date/time filled
// in by hand — never a separate window. POSTs to
// /api/allocations/[id]/return-events (Крок 25), which does the authoritative
// recipient/status/quantity checks; this form only pre-filters what could
// plausibly work, same division of labor as AllocateResourcesModal.
export default function ReturnResourcesModal({
  allocationId,
  itemName,
  unit,
  quantity,
  quantityReturned,
  quantityNotReturnable,
  status,
  alertTitle,
  onClose,
  onReturned,
}: ReturnResourcesModalProps) {
  const router = useRouter();
  const remaining = quantity - quantityReturned - quantityNotReturnable;
  const [returnedQty, setReturnedQty] = useState('');
  const [notReturnableQty, setNotReturnableQty] = useState('');
  const [notReturnableReason, setNotReturnableReason] = useState('');
  const [message, setMessage] = useState('');
  const [returnedAt, setReturnedAt] = useState(nowForDatetimeLocal());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnedNum = Number(returnedQty) || 0;
  const notReturnableNum = Number(notReturnableQty) || 0;
  const sum = returnedNum + notReturnableNum;
  const canSubmit =
    Number.isInteger(returnedNum) &&
    Number.isInteger(notReturnableNum) &&
    returnedNum >= 0 &&
    notReturnableNum >= 0 &&
    sum > 0 &&
    sum <= remaining &&
    !!returnedAt;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    const result = await apiSend(`/api/allocations/${allocationId}/return-events`, 'POST', {
      quantityReturned: returnedNum,
      quantityNotReturnable: notReturnableNum,
      notReturnableReason: notReturnableNum > 0 ? notReturnableReason.trim() || undefined : undefined,
      message: message.trim() || undefined,
      returnedAt: new Date(returnedAt).toISOString(),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.refresh();
    onReturned?.();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Zwróć zasoby</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {itemName} · {alertTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-600">
            Ilość przydziału: <span className="font-bold text-slate-900">{quantity} {unit}</span>. Zwrócono dotąd:{' '}
            <span className="font-semibold">{quantityReturned}</span>. Nie podlega zwrotowi:{' '}
            <span className="font-semibold">{quantityNotReturnable}</span>. Do rozliczenia:{' '}
            <span className="font-bold text-slate-900">{remaining} {unit}</span>.
          </p>
          <AllocationStatusBadge status={status} className="shrink-0" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Zwrócono
              </label>
              <input
                type="number"
                min={0}
                step={1}
                max={remaining}
                value={returnedQty}
                onChange={(e) => setReturnedQty(e.target.value)}
                className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Nie podlega zwrotowi
              </label>
              <input
                type="number"
                min={0}
                step={1}
                max={remaining}
                value={notReturnableQty}
                onChange={(e) => setNotReturnableQty(e.target.value)}
                className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {sum > remaining && (
            <p className="text-[11px] text-rose-600 -mt-3">Suma przekracza ilość pozostałą do rozliczenia.</p>
          )}

          {notReturnableNum > 0 && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Powód (opcjonalnie)
              </label>
              <input
                type="text"
                value={notReturnableReason}
                onChange={(e) => setNotReturnableReason(e.target.value)}
                placeholder="np. uszkodzone, zużyte"
                className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Data i godzina zwrotu
            </label>
            <input
              type="datetime-local"
              required
              value={returnedAt}
              onChange={(e) => setReturnedAt(e.target.value)}
              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Wiadomość (opcjonalnie)
            </label>
            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="np. zwrócono częściowo, 2 szt. uszkodzone"
              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none resize-none"
            />
          </div>

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
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm shadow-amber-600/25 transition disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Zapisywanie...</span>
                </>
              ) : (
                <>
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>Zwróć zasoby</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
