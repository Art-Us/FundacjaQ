'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Save } from 'lucide-react';
import { getResourceGroupInfo, getResourceGroupActiveClass, getHorizonInfo, getHorizonActiveClass } from '@/lib/resourceLabels';
import { MATRIX_GROUPS, MATRIX_HORIZONS, type MatrixCategoryRow, type MatrixGroup, type MatrixHorizon } from '@/lib/resourceMatrix';

export interface EditableResource {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  horizon: MatrixHorizon;
  organization: { id: string; name: string };
}

interface ResourceEditModalProps {
  resource: EditableResource;
  // Every category across every group (not just the resource's current
  // group) — so the coordinator can also move the resource into a different
  // category/group while editing, the same freedom "Zgłoś nowe zasoby" gives
  // on create.
  categories: MatrixCategoryRow[];
  // The (category, ...) the drawer row was fetched under — used only to seed
  // the initial group/category selection before the coordinator touches it.
  initialCategory: MatrixCategoryRow;
  onClose: () => void;
  onSaved: () => void;
}

// "Edytuj Zasób" — opens on top of ResourceMatrixCellDrawer ("Szczegóły
// Dostępności Zasobów") when a coordinator clicks the pencil on one of their
// own organization's declarations (gated one level up, in the drawer, by
// isAdmin || row.organization.id === currentUserOrganizationId — this modal
// itself doesn't re-check that, it trusts the caller). Mirrors
// ResourceFormModal.tsx's 4-section layout, but unlike that form the name is
// always its own editable field, never silently overwritten by whichever
// category is selected — that coupling is exactly what caused the "custom
// name resources are unidentifiable in the matrix" bug this edit UI is meant
// to help recover from.
export default function ResourceEditModal({ resource, categories, initialCategory, onClose, onSaved }: ResourceEditModalProps) {
  const [group, setGroup] = useState<MatrixGroup>(initialCategory.group);
  const [categoryId, setCategoryId] = useState(initialCategory.categoryId);
  const [name, setName] = useState(resource.name);
  const [quantity, setQuantity] = useState(String(resource.quantity));
  const [unit, setUnit] = useState(resource.unit);
  const [horizon, setHorizon] = useState<MatrixHorizon>(resource.horizon);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoriesInGroup = categories.filter((c) => c.group === group);
  const canSubmit = !!categoryId && name.trim().length > 0 && quantity.trim() !== '' && Number(quantity) >= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/resources/${resource.id}`, {
      method: 'PATCH',
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
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? 'Coś poszło nie tak.');
      return;
    }

    onSaved();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      // This modal is a React child of ResourceMatrixCellDrawer (rendered via
      // its own nested createPortal), and that drawer's backdrop has
      // onClick={onClose}. React bubbles portal events through the React
      // tree, not the DOM tree, so without this stop a click anywhere in
      // here would also close the drawer underneath.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Edytuj Zasób</h3>
            <p className="text-xs text-slate-500 mt-0.5">{resource.organization.name}</p>
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
                      const firstInGroup = categories.find((c) => c.group === g);
                      if (firstInGroup) setCategoryId(firstInGroup.categoryId);
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

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">2. Podkategoria</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
            >
              {categoriesInGroup.map((c) => (
                <option key={c.categoryId} value={c.categoryId}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">3. Nazwa zasobu</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Nazwa zasobu (np. Plandeki budowlane 10x15)"
              className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-3 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">4. Ilość</label>
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
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">5. Horyzont czasowy</label>
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
              disabled={saving || !canSubmit}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm shadow-indigo-600/25 transition disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Zapisywanie...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Zapisz zmiany</span>
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
