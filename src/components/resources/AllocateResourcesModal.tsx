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
  needId: string;
  needTitle: string;
  needCategoryId: string;
  // How much the need still lacks — shown as a hint and used only for a soft
  // over-allocation warning (нюанс #9: "варто додати попередження w UI"),
  // never a hard cap: the API itself doesn't reject donations past this
  // amount, since a need can legitimately end up over-covered.
  remainingQuantity: number;
  currentUserOrganizationId: string | null;
  onClose: () => void;
  onAllocated?: () => void;
}

// "Przydziel zasoby" (R11) — a donor organization picks one of ITS OWN
// resources in the need's category and offers a quantity toward it. POSTs to
// /api/alerts/[id]/allocations (Крок 23), which does the actual ownership/
// availability checks server-side; this form only pre-filters the dropdown to
// what could plausibly work; so a stale/raced quantity is still refused by
// the API's own check.
export default function AllocateResourcesModal({
  alertId,
  needId,
  needTitle,
  needCategoryId,
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
  const quantityNum = Number(quantity);
  const canSubmit = !!selected && quantityNum > 0 && Number.isInteger(quantityNum) && quantityNum <= available;
  const overRemaining = remainingQuantity > 0 && quantityNum > remainingQuantity;

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
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Ilość</label>
              <input
                type="number"
                min={1}
                step={1}
                max={available || undefined}
                required
                disabled={!selected}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={selected ? `maks. ${available} ${selected.unit}` : undefined}
                className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              {selected && quantityNum > available && (
                <p className="text-[11px] text-rose-600 mt-1">Przekracza dostępną ilość tego zasobu.</p>
              )}
              {overRemaining && quantityNum <= available && (
                <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Zapotrzebowanie potrzebuje jeszcze {remainingQuantity} {selected?.unit} — przydzielasz więcej.
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
