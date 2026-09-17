'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Send } from 'lucide-react';
import { getResourceGroupInfo, getHorizonInfo } from '@/lib/resourceLabels';
import { MATRIX_GROUPS, MATRIX_HORIZONS, type MatrixCategoryRow, type MatrixGroup, type MatrixHorizon } from '@/lib/resourceMatrix';

interface ResourceFormModalProps {
  // The matrix already loads every ResourceCategory (including ones with no
  // resources yet — see computeResourceMatrix in lib/resourceMatrix.ts), so
  // this reuses that same list instead of fetching it again.
  categories: MatrixCategoryRow[];
  onClose: () => void;
}

// "+ Zgłoś nowe zasoby" (R10, fot. 6) — POSTs to /api/resources (Крок 18) for
// the caller's own organization. Presented as one form with 4 labeled
// sections (matching fot. 6's step order) rather than a paginated wizard, the
// same single-screen-modal convention AlertEditModal.tsx already uses
// elsewhere in this app.
export default function ResourceFormModal({ categories, onClose }: ResourceFormModalProps) {
  const router = useRouter();
  const [group, setGroup] = useState<MatrixGroup | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('szt');
  const [horizon, setHorizon] = useState<MatrixHorizon>('H24');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoriesInGroup = group ? categories.filter((c) => c.group === group) : [];
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
    onClose();
  }

  return (
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
                      setCategoryId('');
                      setName('');
                    }}
                    className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                      active ? info.badgeClass : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
              value={categoryId}
              onChange={(e) => {
                const nextCategoryId = e.target.value;
                setCategoryId(nextCategoryId);
                const category = categoriesInGroup.find((c) => c.categoryId === nextCategoryId);
                if (category) setName(category.name);
              }}
              disabled={!group}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2 px-3 text-slate-900 text-xs mb-2 focus:bg-white focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed"
            >
              <option value="">Wybierz kategorię…</option>
              {categoriesInGroup.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              disabled={!categoryId}
              placeholder="Nazwa zasobu (np. Plandeki budowlane 10x15)"
              className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed"
            />
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
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2 px-3 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Jednostka</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={20}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
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
                      active ? info.badgeClass : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
    </div>
  );
}
