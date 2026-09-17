'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getHorizonInfo } from '@/lib/resourceLabels';
import { MATRIX_HORIZONS, type MatrixCategoryRow, type MatrixHorizon } from '@/lib/resourceMatrix';

interface ResourceMatrixCellDrawerProps {
  category: MatrixCategoryRow;
  horizon: MatrixHorizon;
  onClose: () => void;
}

interface ResourceRow {
  quantity: number;
  reservedQuantity: number;
  horizon: MatrixHorizon;
  organization: { id: string; name: string };
}

interface OrganizationBreakdownRow {
  organizationId: string;
  organizationName: string;
  quantity: number;
  reservedQuantity: number;
  available: number;
}

// The table (ResourceMatrixView.tsx) only shows the aggregated sum per cell
// (Крок 20) — this drawer answers "which organization, how much" for one
// specific (category, horizon) intersection. Reuses GET /api/resources
// (Крок 18) filtered by categoryId only, then applies the cumulative
// H24⊂H48⊂H72⊂WEEK rule (decision #2) client-side over every horizon up to
// and including the selected column — same rule computeResourceMatrix
// (lib/resourceMatrix.ts) applies server-side for the aggregate itself.
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
  const breakdown: OrganizationBreakdownRow[] = [];
  if (rows) {
    const byOrg = new Map<string, OrganizationBreakdownRow>();
    for (const row of rows) {
      const rowIndex = MATRIX_HORIZONS.indexOf(row.horizon);
      if (rowIndex === -1 || rowIndex > uptoIndex) continue;
      const existing = byOrg.get(row.organization.id);
      if (existing) {
        existing.quantity += row.quantity;
        existing.reservedQuantity += row.reservedQuantity;
        existing.available = Math.max(existing.quantity - existing.reservedQuantity, 0);
      } else {
        byOrg.set(row.organization.id, {
          organizationId: row.organization.id,
          organizationName: row.organization.name,
          quantity: row.quantity,
          reservedQuantity: row.reservedQuantity,
          available: Math.max(row.quantity - row.reservedQuantity, 0),
        });
      }
    }
    breakdown.push(...Array.from(byOrg.values()).sort((a, b) => b.quantity - a.quantity));
  }

  const horizonInfo = getHorizonInfo(horizon);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-950/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-white h-full shadow-xl p-6 overflow-y-auto space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">{category.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{horizonInfo.label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
        {!rows && !error && <p className="text-xs text-slate-400">Ładowanie…</p>}
        {rows && breakdown.length === 0 && !error && (
          <p className="text-xs text-slate-500">Żadna organizacja nie zgłosiła jeszcze tego zasobu w tym horyzoncie.</p>
        )}

        {breakdown.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {breakdown.map((row) => (
              <li key={row.organizationId} className="py-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800">{row.organizationName}</span>
                <span className="text-xs text-slate-500">
                  <span className="font-bold text-slate-900">{row.available}</span> / {row.quantity} dostępnych
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
