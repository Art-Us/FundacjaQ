'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Send, PackageOpen, AlertTriangle } from 'lucide-react';
import { getHorizonShortLabel } from '@/lib/resourceLabels';

interface AllocatableResource {
  id: string;
  name: string;
  quantity: number;
  reservedQuantity: number;
  unit: string;
  horizon: string;
}

interface AllocateResourcesModalProps {
  alertId: string;
  alertLocationLabel: string;
  needId: string;
  needTitle: string;
  needCategoryId: string;
  needQuantityNeeded: number;
  needQuantityFulfilled: number;
  needUnit: string;
  // How much the need still lacks — a HARD cap now, matching the API's own
  // check in POST /api/alerts/[id]/allocations: a single donation can never
  // push a need past what it's missing, even if the donor's own stock would
  // allow more.
  remainingQuantity: number;
  currentUserOrganizationId: string | null;
  onClose: () => void;
  onAllocated?: () => void;
}

// "Przydziel zasoby" (R11) — a donor organization picks one of ITS OWN
// resources in the need's category and offers a quantity toward it. POSTs to
// /api/alerts/[id]/allocations (Крок 23), which does the actual ownership/
// availability/remaining-need checks server-side; this form only pre-filters
// the dropdown and caps the quantity input to what could plausibly work, so a
// stale/raced quantity is still refused by the API's own check.
export default function AllocateResourcesModal({
  alertId,
  alertLocationLabel,
  needId,
  needTitle,
  needCategoryId,
  needQuantityNeeded,
  needQuantityFulfilled,
  needUnit,
  remainingQuantity,
  currentUserOrganizationId,
  onClose,
  onAllocated,
}: AllocateResourcesModalProps) {
  const router = useRouter();
  const [resources, setResources] = useState<AllocatableResource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resourceId, setResourceId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [confirmNameMismatch, setConfirmNameMismatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUserOrganizationId) {
      setResources([]);
      return;
    }

    const params = new URLSearchParams({ organizationId: currentUserOrganizationId, categoryId: needCategoryId });
    fetch(`/api/resources?${params}`)
      .then((res) => res.json())
      .then((data) => setResources(data.resources ?? []))
      .catch(() => setLoadError('Nie udało się pobrać Twoich zasobów.'));
  }, [currentUserOrganizationId, needCategoryId]);

  const selected = resources?.find((r) => r.id === resourceId) ?? null;
  const available = selected ? selected.quantity - selected.reservedQuantity : 0;
  // The hard cap on what this one donation may be: never more than the
  // donor's own free stock, and never more than the need is still missing.
  const allowedMax = Math.min(available, remainingQuantity);
  const quantityNum = Number(quantity);
  // The dropdown lists every resource in the need's category (Sprzęt
  // medyczny can mean both "Zestawy pierwszej pomocy" and "Nosze
  // ratownicze") — there's no structural link between a need's title and a
  // resource's name, only the shared category. This can't tell "same item,
  // different wording" apart from "genuinely different item", so it's a
  // confirmable warning, not a hard block.
  const nameMismatch = !!selected && selected.name.trim().toLowerCase() !== needTitle.trim().toLowerCase();
  const canSubmit =
    !!selected &&
    quantityNum > 0 &&
    Number.isInteger(quantityNum) &&
    quantityNum <= allowedMax &&
    (!nameMismatch || confirmNameMismatch);
  const exceedsAvailable = selected && quantityNum > available;
  const exceedsRemaining = selected && quantityNum > remainingQuantity && quantityNum <= available;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;

    setSubmitting(true);
    setError(null);

    const res = await fetch(`/api/alerts/${alertId}/allocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ needId, resourceId: selected.id, quantity: quantityNum }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
    onAllocated?.();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Przydziel zasoby</h3>
            <p className="text-xs text-slate-500 mt-0.5">{needTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-xs">
          <div className="flex items-start justify-between gap-3">
            <span className="text-slate-500 shrink-0">Miejsce zdarzenia:</span>
            <span className="font-semibold text-slate-900 text-right">{alertLocationLabel}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-slate-500 shrink-0">Potrzebny zasób:</span>
            <span className="font-semibold text-indigo-600 text-right">{needTitle}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-slate-500 shrink-0">Stan realizacji:</span>
            <span className="font-semibold text-slate-900 text-right">
              {needQuantityFulfilled} / {needQuantityNeeded} {needUnit}{' '}
              <span className="font-normal text-slate-500">(Brakuje: {remainingQuantity} {needUnit})</span>
            </span>
          </div>
        </div>

        {loadError ? (
          <p className="text-xs text-rose-600 py-6 text-center">{loadError}</p>
        ) : resources === null ? (
          <p className="text-xs text-slate-500 py-6 text-center">Ładowanie Twoich zasobów…</p>
        ) : resources.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <PackageOpen className="h-8 w-8 text-slate-300" />
            <p className="text-xs text-slate-500">
              Nie masz żadnego zasobu w tej kategorii. Zgłoś go najpierw na stronie „Zasoby”.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Twój zasób
              </label>
              <select
                value={resourceId}
                onChange={(e) => {
                  setResourceId(e.target.value);
                  setQuantity('');
                  setConfirmNameMismatch(false);
                }}
                required
                className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="">Wybierz zasób…</option>
                {resources.map((r) => {
                  const free = r.quantity - r.reservedQuantity;
                  return (
                    <option key={r.id} value={r.id} disabled={free <= 0}>
                      {r.name} — dostępne {free} {r.unit} ({getHorizonShortLabel(r.horizon)})
                    </option>
                  );
                })}
              </select>

              {nameMismatch && (
                <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
                  <p className="flex items-start gap-2 text-[11px] text-amber-700 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Nazwa zasobu („{selected?.name}") różni się od nazwy zapotrzebowania („{needTitle}"). Mimo wspólnej
                    kategorii to może być inny przedmiot.
                  </p>
                  <label className="flex items-start gap-2 text-[11px] text-amber-800 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmNameMismatch}
                      onChange={(e) => setConfirmNameMismatch(e.target.checked)}
                      className="mt-0.5"
                    />
                    Tak, celowo przekazuję inny przedmiot na to zapotrzebowanie.
                  </label>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Ilość do przekazania{selected ? ` (${selected.unit})` : ''}
                </label>
                {selected && (
                  <span className="text-[11px] text-slate-400">
                    {exceedsAvailable ? (
                      <span className="text-rose-600 font-semibold">Brakuje: {quantityNum - available}</span>
                    ) : (
                      <>W magazynie: {available}</>
                    )}
                  </span>
                )}
              </div>
              <input
                type="number"
                min={1}
                step={1}
                max={allowedMax || undefined}
                required
                disabled={!selected}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={selected ? `maks. ${allowedMax} ${selected.unit}` : undefined}
                className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />

              {selected && allowedMax > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {[5, 10].map((quick) =>
                    quick < allowedMax ? (
                      <button
                        key={quick}
                        type="button"
                        onClick={() => setQuantity(String(quick))}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                          quantityNum === quick
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {quick} {selected.unit}
                      </button>
                    ) : null
                  )}
                  <button
                    type="button"
                    onClick={() => setQuantity(String(allowedMax))}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                      quantityNum === allowedMax
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Maks. dozwolony przydział ({allowedMax})
                  </button>
                </div>
              )}

              {exceedsAvailable && (
                <p className="text-[11px] text-rose-600 mt-1.5">Przekracza dostępną ilość tego zasobu.</p>
              )}
              {exceedsRemaining && (
                <p className="text-[11px] text-rose-600 mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Przekracza brakującą ilość zapotrzebowania — maksymalnie {remainingQuantity} {selected?.unit}.
                </p>
              )}
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
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm shadow-emerald-600/25 transition disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Przydzielanie...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Przydziel zasoby</span>
                  </>
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
