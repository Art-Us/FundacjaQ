'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, X } from 'lucide-react';
import { getHorizonInfo, getHorizonShortLabel, HORIZON_SUBTITLES } from '@/lib/resourceLabels';
import { MATRIX_HORIZONS, type MatrixCategoryRow, type MatrixHorizon } from '@/lib/resourceMatrix';

interface ResourceMatrixCellDrawerProps {
  category: MatrixCategoryRow;
  horizon: MatrixHorizon;
  onClose: () => void;
}

interface ResourceRow {
  id: string;
  quantity: number;
  reservedQuantity: number;
  unit: string;
  description: string | null;
  horizon: MatrixHorizon;
  organization: { id: string; name: string };
}

interface Declaration {
  id: string;
  organizationName: string;
  description: string | null;
  quantity: number;
  unit: string;
  horizon: MatrixHorizon;
}

// Centered "Szczegóły Dostępności Zasobów" modal — the table
// (ResourceMatrixView.tsx) only shows the aggregated sum per cell (Крок 20);
// this answers "which organization declared what" for one specific
// (category, horizon) intersection. Reuses GET /api/resources (Крок 18)
// filtered by categoryId only, then applies the cumulative H24⊂H48⊂H72⊂WEEK
// rule (decision #2) client-side over every horizon up to and including the
// selected column — same rule computeResourceMatrix (lib/resourceMatrix.ts)
// applies server-side for the aggregate itself. Each declaration is shown as
// its own row (not merged per organization) so its own horizon/quantity/
// description stay attributable — an organization with two separate
// declarations at different horizons would otherwise be impossible to
// summarize into one honest "Gotowość" figure.
export default function ResourceMatrixCellDrawer({ category, horizon, onClose }: ResourceMatrixCellDrawerProps) {
  const [rows, setRows] = useState<ResourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);

    fetch(`/api/resources?categoryId=${encodeURIComponent(category.categoryId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('request failed'))))
      .then((data) => {
        if (!cancelled) setRows(data.resources ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('Nie udało się pobrać szczegółów.');
      });

    return () => {
      cancelled = true;
    };
  }, [category.categoryId]);

  const uptoIndex = MATRIX_HORIZONS.indexOf(horizon);
  const declarations: Declaration[] = (rows ?? [])
    .filter((row) => {
      const rowIndex = MATRIX_HORIZONS.indexOf(row.horizon);
      return rowIndex !== -1 && rowIndex <= uptoIndex;
    })
    .map((row) => ({
      id: row.id,
      organizationName: row.organization.name,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      horizon: row.horizon,
    }))
    .sort(
      (a, b) => MATRIX_HORIZONS.indexOf(a.horizon) - MATRIX_HORIZONS.indexOf(b.horizon) || b.quantity - a.quantity
    );

  const cell = category.horizons[horizon];
  // Best-effort, derived straight from what's actually declared in scope —
  // never a fabricated per-category unit (resources in the same category can
  // legitimately use different units).
  const totalUnit = declarations[0]?.unit ?? '';
  const horizonInfo = getHorizonInfo(horizon);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white shadow-xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <span className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Layers className="h-5 w-5 text-indigo-600" />
            Szczegóły Dostępności Zasobów
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-2.5 border-b border-slate-100 bg-slate-50/60 shrink-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Kategoria:</span>
            <span className="font-bold text-indigo-600">{category.name}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Horyzont czasowy:</span>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${horizonInfo.badgeClass}`}>
              {getHorizonShortLabel(horizon)} ({HORIZON_SUBTITLES[horizon]})
            </span>
          </div>
          <div className="flex items-center justify-between text-sm pt-1">
            <span className="text-slate-500">Łączna dostępna ilość:</span>
            <span className="text-lg font-bold text-slate-900">
              {cell.available}
              {totalUnit ? ` ${totalUnit}` : ''}
            </span>
          </div>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Zadeklarowane przez jednostki ({declarations.length}):
          </p>

          {error && <p className="text-xs text-rose-600">{error}</p>}
          {!rows && !error && <p className="text-xs text-slate-400">Ładowanie…</p>}
          {rows && declarations.length === 0 && !error && (
            <p className="text-xs text-slate-500">Żadna organizacja nie zgłosiła jeszcze tego zasobu w tym horyzoncie.</p>
          )}

          <ul className="divide-y divide-slate-100">
            {declarations.map((row) => (
              <li key={row.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{row.organizationName}</p>
                  {row.description && <p className="text-xs text-slate-400 mt-0.5">{row.description}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-900">
                    {row.quantity} {row.unit}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Gotowość: {getHorizonShortLabel(row.horizon)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
