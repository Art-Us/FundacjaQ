'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Send } from 'lucide-react';
import { getResourceGroupInfo, getResourceGroupActiveClass, getHorizonInfo, getHorizonActiveClass } from '@/lib/resourceLabels';
import { MATRIX_GROUPS, MATRIX_HORIZONS, type MatrixCategoryRow, type MatrixGroup, type MatrixHorizon } from '@/lib/resourceMatrix';

interface ResourceFormModalProps {
  // The matrix already loads every ResourceCategory (including ones with no
  // resources yet — see computeResourceMatrix in lib/resourceMatrix.ts), so
  // this reuses that same list instead of fetching it again.
  categories: MatrixCategoryRow[];
  onClose: () => void;
  // Lets ResourceMatrixView re-run the exact same fetch its own "Odśwież"
  // button uses (respecting whatever "Posiadacz" filter is currently active)
  // right after a successful create — router.refresh() alone re-fetches
  // page.tsx's server data, but ResourceMatrixView already forked that into
  // its own `tiles`/`categories` state (for the live Posiadacz refetch), so
  // new server props alone would never reach the table without this.
  onCreated?: () => void;
}

// Sentinel <option> value for "let me type my own name" — distinct from any
// real cuid categoryId, so it can never collide with an actual category.
const CUSTOM_NAME_OPTION = '__custom__';

// Every group needs one broad, catch-all category to submit under when the
// caller picks "Własna nazwa zasobu…" instead of one of the specific listed
// subcategories — POST /api/resources always requires a real categoryId
// (Крок 18), there's no "uncategorized" option server-side. Keep this in
// sync with prisma/seed.ts's seedKategorie(): each of these four names must
// exist as a real ResourceCategory in that group, or the custom-name path
// has nothing to submit against.
const GROUP_FALLBACK_CATEGORY_NAME: Record<MatrixGroup, string> = {
  PEOPLE: 'Ludzie / Wolontariusze',
  WATER: 'Woda pitna',
  EQUIPMENT: 'Inny sprzęt',
  OTHER: 'Inne materiały',
};

// "+ Zgłoś nowe zasoby" (R10, fot. 6) — POSTs to /api/resources (Крок 18) for
// the caller's own organization. Presented as one form with 4 labeled
// sections (matching fot. 6's step order) rather than a paginated wizard, the
// same single-screen-modal convention AlertEditModal.tsx already uses
// elsewhere in this app.
export default function ResourceFormModal({ categories, onClose, onCreated }: ResourceFormModalProps) {
  const router = useRouter();
  const [group, setGroup] = useState<MatrixGroup | null>(null);
  // Holds either a real categoryId or the CUSTOM_NAME_OPTION sentinel — see
  // categoryId below for what actually gets submitted.
  const [selectedOption, setSelectedOption] = useState('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('szt');
  const [horizon, setHorizon] = useState<MatrixHorizon>('H24');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoriesInGroup = group ? categories.filter((c) => c.group === group) : [];
  const isCustomName = selectedOption === CUSTOM_NAME_OPTION;
  const fallbackCategoryId = group
    ? categoriesInGroup.find((c) => c.name === GROUP_FALLBACK_CATEGORY_NAME[group])?.categoryId
    : undefined;
  const categoryId = isCustomName ? fallbackCategoryId : selectedOption;
  const canSubmit = !!categoryId && name.trim().length > 0 && Number(quantity) > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        categoryId,
        quantity: Number(quantity),
        unit: unit.trim() || 'szt',
        horizon,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    router.refresh();
    onCreated?.();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Zgłoś Nowy Zasób do Matrycy</h3>
            <p className="text-xs text-slate-500 mt-0.5">Zadeklaruj zasób swojej organizacji.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">1. Kategoria</label>
            <div className="grid grid-cols-2 gap-2">
              {MATRIX_GROUPS.map((g) => {
                const info = getResourceGroupInfo(g);
                const active = group === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setGroup(g);
                      setSelectedOption('');
                      setName('');
                    }}
                    className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                      active ? getResourceGroupActiveClass(g) : info.badgeClass + ' hover:brightness-95'
                    }`}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={group ? undefined : 'opacity-40'}>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              2. Podkategoria / nazwa
            </label>
            <select
              value={selectedOption}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedOption(value);
                if (value === CUSTOM_NAME_OPTION) {
                  setName('');
                } else {
                  const category = categoriesInGroup.find((c) => c.categoryId === value);
                  setName(category?.name ?? '');
                }
              }}
              disabled={!group}
              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed"
            >
              <option value="">Wybierz kategorię…</option>
              {categoriesInGroup.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
              <option value={CUSTOM_NAME_OPTION}>➕ Własna nazwa zasobu…</option>
            </select>
            {isCustomName && (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                autoFocus
                placeholder="Nazwa zasobu (np. Plandeki budowlane 10x15)"
                className="mt-2 w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">3. Ilość</label>
              <input
                type="number"
                min={0}
                step={1}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Jednostka</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={20}
                className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">4. Horyzont czasowy</label>
            <div className="grid grid-cols-4 gap-2">
              {MATRIX_HORIZONS.map((h) => {
                const info = getHorizonInfo(h);
                const active = horizon === h;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHorizon(h)}
                    className={`rounded-xl border px-2 py-2 text-[11px] font-bold transition ${
                      active ? getHorizonActiveClass(h) : info.badgeClass + ' hover:brightness-95'
                    }`}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>
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
              disabled={loading || !canSubmit}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm shadow-indigo-600/25 transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Zapisywanie...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Zgłoś zasób</span>
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
