'use client';

import { useMemo, useState } from 'react';
import { Plus, RefreshCw, Users, Droplet, Wrench, Package } from 'lucide-react';
import { getResourceGroupInfo, getHorizonInfo } from '@/lib/resourceLabels';
import { MATRIX_HORIZONS, type MatrixTile, type MatrixCategoryRow, type MatrixGroup, type MatrixHorizon } from '@/lib/resourceMatrix';
import ResourceMatrixCellDrawer from './ResourceMatrixCellDrawer';
import ResourceFormModal from './ResourceFormModal';

const GROUP_ICONS: Record<MatrixGroup, React.ReactNode> = {
  PEOPLE: <Users className="h-5 w-5" />,
  WATER: <Droplet className="h-5 w-5" />,
  EQUIPMENT: <Wrench className="h-5 w-5" />,
  OTHER: <Package className="h-5 w-5" />,
};

const GROUP_CHIPS: MatrixGroup[] = ['PEOPLE', 'WATER', 'EQUIPMENT', 'OTHER'];

interface ResourceMatrixViewProps {
  initialTiles: MatrixTile[];
  initialCategories: MatrixCategoryRow[];
  organizations: { id: string; name: string }[];
}

interface SelectedCell {
  category: MatrixCategoryRow;
  horizon: MatrixHorizon;
}

// Каркас сторінки (R10, fot. 1) — тепер повністю підключений у page.tsx
// (Крок 37). "Odśwież" — єдиний спосіб дізнатись свіжі дані (немає realtime-
// інфраструктури): він же (не сама зміна фільтра) робить дропдаун
// "Posiadacz" дійсно організаційно-скоуп-запитом до сервера. Group НЕ
// передається в цей запит навмисно — інакше після оновлення з обраною
// групою решта груп зникли б зі стану аж до наступного оновлення без
// фільтра; чіпи категорій продовжують фільтрувати вже завантажені дані на
// клієнті миттєво, незалежно від "Odśwież".
export default function ResourceMatrixView({ initialTiles, initialCategories, organizations }: ResourceMatrixViewProps) {
  const [tiles, setTiles] = useState(initialTiles);
  const [categories, setCategories] = useState(initialCategories);
  const [selectedGroup, setSelectedGroup] = useState<MatrixGroup | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>('');
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const filteredCategories = useMemo(
    () => (selectedGroup ? categories.filter((category) => category.group === selectedGroup) : categories),
    [categories, selectedGroup]
  );

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const params = new URLSearchParams();
      if (selectedOrganizationId) params.set('organizationId', selectedOrganizationId);
      const res = await fetch(`/api/resources/matrix?${params.toString()}`);
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      setTiles(data.tiles);
      setCategories(data.categories);
    } catch {
      setRefreshError('Nie udało się odświeżyć danych.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {tiles.map((tile) => {
          const info = getResourceGroupInfo(tile.group);
          return (
            <div key={tile.group} className="rounded-2xl border border-slate-200/80 bg-white shadow-xs p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${info.badgeClass}`}>
                {GROUP_ICONS[tile.group]}
              </div>
              <p className="mt-3 text-xs text-slate-500 font-semibold">{info.label}</p>
              <p className="text-2xl font-bold text-slate-900">{tile.quantity}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">w 24h: {tile.within24h}</p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2">
        {refreshError && <p className="text-xs text-rose-600 mr-auto">{refreshError}</p>}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Odśwież</span>
        </button>
        <button
          type="button"
          onClick={() => setShowFormModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm shadow-indigo-600/25 transition"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Zgłoś nowe zasoby</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedGroup(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              selectedGroup === null
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Wszystkie
          </button>
          {GROUP_CHIPS.map((group) => {
            const info = getResourceGroupInfo(group);
            const active = selectedGroup === group;
            return (
              <button
                key={group}
                type="button"
                onClick={() => setSelectedGroup(active ? null : group)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  active ? info.badgeClass : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {info.label}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold">Posiadacz</span>
          <select
            value={selectedOrganizationId}
            onChange={(e) => setSelectedOrganizationId(e.target.value)}
            className="rounded-xl bg-white border border-slate-200 py-1.5 px-2.5 text-xs text-slate-900"
          >
            <option value="">Wszyscy</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200/80 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-3 px-4">Zasób</th>
                {MATRIX_HORIZONS.map((horizon) => (
                  <th key={horizon} className="py-3 px-4">
                    {getHorizonInfo(horizon).label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCategories.length === 0 ? (
                <tr>
                  <td colSpan={MATRIX_HORIZONS.length + 1} className="py-8 px-4 text-center text-slate-500">
                    Brak zasobów w tej kategorii.
                  </td>
                </tr>
              ) : (
                filteredCategories.map((category) => {
                  const groupInfo = getResourceGroupInfo(category.group);
                  return (
                    <tr key={category.categoryId} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-4 font-semibold text-slate-800">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full mr-2 ${groupInfo.dotClass}`} />
                        {category.name}
                      </td>
                      {MATRIX_HORIZONS.map((horizon) => {
                        const cell = category.horizons[horizon];
                        return (
                          <td key={horizon} className="py-1 px-1">
                            <button
                              type="button"
                              onClick={() => setSelectedCell({ category, horizon })}
                              className="w-full rounded-lg px-3 py-2 text-left hover:bg-indigo-50 transition"
                            >
                              <span className="font-bold text-slate-900">{cell.available}</span>
                              <span className="text-slate-400"> / {cell.quantity}</span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCell && (
        <ResourceMatrixCellDrawer
          category={selectedCell.category}
          horizon={selectedCell.horizon}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {showFormModal && <ResourceFormModal categories={categories} onClose={() => setShowFormModal(false)} />}
    </div>
  );
}
