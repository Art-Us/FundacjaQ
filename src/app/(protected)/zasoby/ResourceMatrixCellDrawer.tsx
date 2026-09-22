'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Layers, Pencil, Trash2, X } from 'lucide-react';
import { getHorizonInfo, getHorizonShortLabel, HORIZON_SUBTITLES } from '@/lib/resourceLabels';
import type { MatrixCategoryRow, MatrixHorizon } from '@/lib/resourceMatrix';
import ResourceEditModal from './ResourceEditModal';
import { apiFetch, apiSend } from '@/lib/apiClient';

interface ResourceMatrixCellDrawerProps {
  category: MatrixCategoryRow;
  horizon: MatrixHorizon;
  // The "Posiadacz" filter currently applied to the table (empty = wszystkie
  // organizacje) — cell.available/cell.quantity above already reflect it
  // (ResourceMatrixView refetches the whole matrix on change), so the
  // per-organization breakdown below must query the same scope, or its list
  // would silently include organizations the header total excludes.
  organizationId: string;
  // Every category (not just this cell's) — threaded through to
  // ResourceEditModal so a coordinator can also move a resource into a
  // different category/group while editing it.
  categories: MatrixCategoryRow[];
  // Gates the per-row "Edytuj" pencil: an ADMIN can edit anyone's
  // declaration, a COORDINATOR only their own organization's — mirrors
  // canManageResource() in src/app/api/resources/[id]/route.ts exactly, so
  // the button never appears where the API would 403 it anyway.
  currentUserOrganizationId: string | null;
  isAdmin: boolean;
  // Bubbles up to ResourceMatrixView after a save/delete so the outer table
  // and stat tiles (which this drawer doesn't own) refetch too — an edit can
  // change quantity/horizon/category, all of which affect cells beyond this
  // one drawer.
  onChanged: () => void;
  onClose: () => void;
}

interface ResourceRow {
  id: string;
  name: string;
  quantity: number;
  reservedQuantity: number;
  unit: string;
  description: string | null;
  horizon: MatrixHorizon;
  organization: { id: string; name: string };
}

interface Declaration {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  description: string | null;
  quantity: number;
  available: number;
  unit: string;
  horizon: MatrixHorizon;
}

// Centered "Szczegóły Dostępności Zasobów" modal — the table
// (ResourceMatrixView.tsx) only shows the aggregated sum per cell (Крок 20);
// this answers "which organization declared what" for one specific
// (category, horizon) intersection. Reuses GET /api/resources (Крок 18)
// filtered by categoryId only, then filters client-side to declarations at
// exactly the selected horizon — same exact-bucket rule
// computeResourceMatrix (lib/resourceMatrix.ts) applies server-side for the
// aggregate itself. Each declaration is shown as its own row (not merged per
// organization) so its own quantity/description stays attributable — an
// organization with two separate declarations would otherwise be impossible
// to summarize into one honest "Gotowość" figure.
export default function ResourceMatrixCellDrawer({
  category,
  horizon,
  organizationId,
  categories,
  currentUserOrganizationId,
  isAdmin,
  onChanged,
  onClose,
}: ResourceMatrixCellDrawerProps) {
  const [rows, setRows] = useState<ResourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<ResourceRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadRows = useCallback(() => {
    let cancelled = false;
    setError(null);

    const params = new URLSearchParams({ categoryId: category.categoryId });
    if (organizationId) params.set('organizationId', organizationId);

    apiFetch<{ resources?: ResourceRow[] }>(`/api/resources?${params.toString()}`).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows(result.data.resources ?? []);
    });

    return () => {
      cancelled = true;
    };
  }, [category.categoryId, organizationId]);

  useEffect(() => {
    setRows(null);
    return loadRows();
  }, [loadRows]);

  function handleEditSaved() {
    setEditingRow(null);
    loadRows();
    onChanged();
  }

  function openEdit(id: string) {
    const fullRow = rows?.find((r) => r.id === id);
    if (fullRow) setEditingRow(fullRow);
  }

  async function handleDeleteRow(id: string) {
    setDeleteLoading(true);
    setDeleteError(null);

    const result = await apiSend(`/api/resources/${id}`, 'DELETE');
    setDeleteLoading(false);

    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setDeletingId(null);
    loadRows();
    onChanged();
  }

  const declarations: Declaration[] = (rows ?? [])
    .filter((row) => row.horizon === horizon)
    .map((row) => ({
      id: row.id,
      name: row.name,
      organizationId: row.organization.id,
      organizationName: row.organization.name,
      description: row.description,
      quantity: row.quantity,
      // Same "available = quantity - reservedQuantity" the matrix table and
      // its header total above use — showing raw `quantity` here would make
      // this list sum to more than "Łączna dostępna ilość" the moment any
      // declaration has an active allocation reserved against it.
      available: row.quantity - row.reservedQuantity,
      unit: row.unit,
      horizon: row.horizon,
    }))
    .sort((a, b) => b.quantity - a.quantity);

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

          <ul className="space-y-3">
            {declarations.map((row) => {
              const canManage = isAdmin || (!!currentUserOrganizationId && row.organizationId === currentUserOrganizationId);
              const confirmingDelete = deletingId === row.id;
              return (
                <li key={row.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{row.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{row.organizationName}</p>
                      {row.description && <p className="text-xs text-slate-400 mt-0.5">{row.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-slate-900">
                        {row.available}
                        <span className="font-normal text-slate-400"> / {row.quantity}</span> {row.unit}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Gotowość: {getHorizonShortLabel(row.horizon)}</p>
                    </div>
                  </div>

                  {canManage &&
                    (confirmingDelete ? (
                      <div className="mt-3 rounded-lg bg-rose-50 border border-rose-200 p-2.5 space-y-2">
                        {deleteError && <p className="text-xs text-rose-700 font-medium">{deleteError}</p>}
                        <p className="flex items-center gap-1.5 text-xs text-rose-700 font-medium">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          Na pewno usunąć ten zasób? Tej operacji nie można cofnąć.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingId(null);
                              setDeleteError(null);
                            }}
                            className="flex-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2 transition"
                          >
                            Anuluj
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(row.id)}
                            disabled={deleteLoading}
                            className="flex-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-2 transition disabled:opacity-50"
                          >
                            {deleteLoading ? 'Usuwanie...' : 'Tak, usuń'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(row.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-2 transition"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edytuj
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeletingId(row.id);
                            setDeleteError(null);
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-2 transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Usuń zasób
                        </button>
                      </div>
                    ))}
                </li>
              );
            })}
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

      {editingRow && (
        <ResourceEditModal
          resource={editingRow}
          categories={categories}
          initialCategory={category}
          onClose={() => setEditingRow(null)}
          onSaved={handleEditSaved}
        />
      )}
    </div>,
    document.body
  );
}
