'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MatrixCategoryRow, MatrixGroup } from '@/lib/resourceMatrix';

const NEED_URGENCIES = ['NORMAL', 'PILNE', 'KRYTYCZNY'] as const;
const URGENCY_LABELS: Record<(typeof NEED_URGENCIES)[number], string> = {
  NORMAL: 'Normalny',
  PILNE: 'Pilne',
  KRYTYCZNY: 'Krytyczny',
};

// Purely cosmetic prefix for the TYP dropdown's <optgroup> — mirrors the
// lucide icons ResourceMatrixView.tsx uses per group (Users/Droplet/Wrench/
// Package), just as plain characters since a native <option> can't render an
// SVG component.
const GROUP_EMOJI: Record<MatrixGroup, string> = {
  PEOPLE: '👥',
  WATER: '💧',
  EQUIPMENT: '🔧',
  OTHER: '📦',
};
const GROUP_LABELS: Record<MatrixGroup, string> = {
  PEOPLE: 'Ludzie',
  WATER: 'Woda',
  EQUIPMENT: 'Sprzęt',
  OTHER: 'Inne',
};
const GROUP_ORDER: MatrixGroup[] = ['PEOPLE', 'WATER', 'EQUIPMENT', 'OTHER'];

export interface ExistingNeed {
  id: string;
  categoryId: string;
  title: string;
  quantityNeeded: number;
  quantityFulfilled: number;
  unit: string;
  urgency: string;
}

// A row being edited — either backed by a real AlertNeed (`id` set) or a
// brand-new one only created locally until Save is pressed.
interface NeedRow {
  key: string;
  id: string | null;
  categoryId: string;
  title: string;
  quantityNeeded: string;
  quantityFulfilled: number;
  unit: string;
  urgency: (typeof NEED_URGENCIES)[number];
}

let tempKeySeq = 0;
function nextTempKey(): string {
  tempKeySeq += 1;
  return `new-${tempKeySeq}`;
}

function emptyRow(defaultCategoryId: string): NeedRow {
  return {
    key: nextTempKey(),
    id: null,
    categoryId: defaultCategoryId,
    title: '',
    quantityNeeded: '',
    quantityFulfilled: 0,
    unit: 'szt',
    urgency: 'NORMAL',
  };
}

interface NeedFormModalProps {
  alertId: string;
  alertLocationLabel: string;
  alertDescription: string;
  existingNeeds: ExistingNeed[];
  onClose: () => void;
  onSaved?: () => void;
}

// "Zarządzaj i Edytuj Zapotrzebowanie Alertu" (R11, fot. 2) — a single modal
// that manages the alert owner org's whole need list at once: add/edit/remove
// rows locally, then commit everything on "Zapisz zmiany" as a batch of
// POST /api/alerts/[id]/needs (Крок 21), PATCH/DELETE /api/needs/[id]
// (Крок 22) calls — matching the client's one-screen mockup rather than a
// single-need-at-a-time form.
export default function NeedFormModal({
  alertId,
  alertLocationLabel,
  alertDescription,
  existingNeeds,
  onClose,
  onSaved,
}: NeedFormModalProps) {
  const router = useRouter();
  const [categories, setCategories] = useState<MatrixCategoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<NeedRow[]>(
    existingNeeds.map((need) => ({
      key: need.id,
      id: need.id,
      categoryId: need.categoryId,
      title: need.title,
      quantityNeeded: String(need.quantityNeeded),
      quantityFulfilled: need.quantityFulfilled,
      unit: need.unit,
      urgency: (NEED_URGENCIES as readonly string[]).includes(need.urgency)
        ? (need.urgency as (typeof NEED_URGENCIES)[number])
        : 'NORMAL',
    }))
  );
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/resources/matrix')
      .then((res) => res.json())
      .then((data) => setCategories(data.categories ?? []))
      .catch(() => setLoadError('Nie udało się pobrać listy kategorii.'));
  }, []);

  const defaultCategoryId = categories?.[0]?.categoryId ?? '';

  function addRow() {
    setRows((prev) => [...prev, emptyRow(defaultCategoryId)]);
  }

  function updateRow(key: string, patch: Partial<NeedRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((prev) => {
      const row = prev.find((r) => r.key === key);
      if (row?.id) {
        setDeletedIds((ids) => [...ids, row.id!]);
      }
      return prev.filter((r) => r.key !== key);
    });
  }

  const canSubmit = rows.every(
    (row) => row.categoryId && row.title.trim().length > 0 && Number(row.quantityNeeded) >= 1
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const failures: string[] = [];

    for (const id of deletedIds) {
      const res = await fetch(`/api/needs/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        failures.push(data.error ?? 'Nie udało się usunąć pozycji.');
      }
    }

    for (const row of rows) {
      const payload = {
        categoryId: row.categoryId,
        title: row.title.trim(),
        quantityNeeded: Number(row.quantityNeeded),
        unit: row.unit,
        urgency: row.urgency,
      };

      const res = row.id
        ? await fetch(`/api/needs/${row.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/alerts/${alertId}/needs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        failures.push(`„${row.title.trim() || 'Nowa pozycja'}”: ${data.error ?? 'błąd zapisu'}`);
      }
    }

    setSaving(false);

    if (failures.length > 0) {
      setError(failures.join(' '));
      return;
    }

    router.refresh();
    onSaved?.();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Pencil className="h-4 w-4 text-indigo-600" />
            Zarządzaj i Edytuj Zapotrzebowanie Alertu
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-1">
          <p className="text-xs text-slate-500">
            Dotyczy zdarzenia: <span className="font-bold text-slate-800">{alertLocationLabel}</span>
          </p>
          <p className="text-xs text-slate-600 italic line-clamp-2">„{alertDescription}”</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Lista zapytań o wsparcie ({rows.length}):
            </h4>
            <button
              type="button"
              onClick={addRow}
              disabled={!categories || categories.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold border border-amber-300 transition disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Dodaj nową pozycję
            </button>
          </div>

          {loadError && <p className="text-xs text-rose-600">{loadError}</p>}

          <div className="space-y-3">
            {rows.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">Brak zgłoszonego zapotrzebowania.</p>
            )}

            {rows.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-1 sm:grid-cols-[1.2fr_2fr_1fr_1fr_auto] gap-3 items-end rounded-2xl border border-slate-200 p-3"
              >
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Typ
                  </label>
                  <select
                    value={row.categoryId}
                    onChange={(e) => updateRow(row.key, { categoryId: e.target.value })}
                    required
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                  >
                    {!categories && <option value="">Ładowanie…</option>}
                    {categories &&
                      GROUP_ORDER.map((group) => {
                        const inGroup = categories.filter((c) => c.group === group);
                        if (inGroup.length === 0) return null;
                        return (
                          <optgroup key={group} label={`${GROUP_EMOJI[group]} ${GROUP_LABELS[group]}`}>
                            {inGroup.map((c) => (
                              <option key={c.categoryId} value={c.categoryId}>
                                {c.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Nazwa / opis
                  </label>
                  <input
                    type="text"
                    value={row.title}
                    onChange={(e) => updateRow(row.key, { title: e.target.value })}
                    maxLength={200}
                    required
                    placeholder="np. Pompy szlamowe dużej wydajności"
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Potrzebna ilość
                  </label>
                  <input
                    type="number"
                    min={Math.max(1, row.quantityFulfilled)}
                    step={1}
                    required
                    value={row.quantityNeeded}
                    onChange={(e) => updateRow(row.key, { quantityNeeded: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
                  />
                  {row.quantityFulfilled > 0 && (
                    <p className="text-[10px] text-slate-400 mt-0.5">już przydzielono: {row.quantityFulfilled}</p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Pilność
                  </label>
                  <select
                    value={row.urgency}
                    onChange={(e) => updateRow(row.key, { urgency: e.target.value as NeedRow['urgency'] })}
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 py-2 px-2.5 text-slate-900 text-xs focus:bg-white focus:border-indigo-500 focus:outline-none"
                  >
                    {NEED_URGENCIES.map((u) => (
                      <option key={u} value={u}>
                        {URGENCY_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  title="Usuń pozycję"
                  className="justify-self-end sm:justify-self-auto rounded-xl p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
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
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Zapisz zmiany w zapotrzebowaniu</span>
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
