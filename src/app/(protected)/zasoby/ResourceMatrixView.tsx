'use client';

import { useMemo, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Users,
  Droplet,
  Wrench,
  Package,
  Filter,
  LayoutGrid,
  Building2,
  ChevronDown,
  Clock,
  Layers,
  Eye,
} from 'lucide-react';
import { getResourceGroupInfo, getResourceGroupActiveClass, getHorizonInfo, HORIZON_SUBTITLES } from '@/lib/resourceLabels';
import { MATRIX_HORIZONS, type MatrixTile, type MatrixCategoryRow, type MatrixGroup, type MatrixHorizon } from '@/lib/resourceMatrix';
import ResourceMatrixCellDrawer from './ResourceMatrixCellDrawer';
import ResourceFormModal from './ResourceFormModal';
import { apiFetch } from '@/lib/apiClient';

const GROUP_ICON_COMPONENTS: Record<MatrixGroup, typeof Users> = {
  PEOPLE: Users,
  WATER: Droplet,
  EQUIPMENT: Wrench,
  OTHER: Package,
};

const GROUP_CHIPS: MatrixGroup[] = ['PEOPLE', 'WATER', 'EQUIPMENT', 'OTHER'];

const CHIP_BASE = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition';
const ALL_CHIP_INACTIVE = 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200';
const ALL_CHIP_ACTIVE = 'bg-indigo-600 text-white border-indigo-600';

interface ResourceMatrixViewProps {
  initialTiles: MatrixTile[];
  initialCategories: MatrixCategoryRow[];
  organizations: { id: string; name: string }[];
  currentUserOrganizationId: string | null;
  isAdmin: boolean;
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
export default function ResourceMatrixView({
  initialTiles,
  initialCategories,
  organizations,
  currentUserOrganizationId,
  isAdmin,
}: ResourceMatrixViewProps) {
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

  async function refreshMatrix(organizationId: string) {
    setRefreshing(true);
    setRefreshError(null);

    const params = new URLSearchParams();
    if (organizationId) params.set('organizationId', organizationId);
    const result = await apiFetch<{ tiles: MatrixTile[]; categories: MatrixCategoryRow[] }>(
      `/api/resources/matrix?${params.toString()}`
    );
    setRefreshing(false);

    if (!result.ok) {
      setRefreshError(result.error);
      return;
    }

    setTiles(result.data.tiles);
    setCategories(result.data.categories);
    // ResourceMatrixCellDrawer's `category` prop is a snapshot taken when the
    // cell was clicked — without this, its "Łączna dostępna ilość" header
    // would keep showing pre-edit numbers after a save inside the drawer
    // (ResourceEditModal) triggers this same refresh.
    setSelectedCell((prev) => {
      if (!prev) return prev;
      const fresh = result.data.categories.find((c) => c.categoryId === prev.category.categoryId);
      return fresh ? { category: fresh, horizon: prev.horizon } : prev;
    });
  }

  function handleRefresh() {
    refreshMatrix(selectedOrganizationId);
  }

  // "Posiadacz" refetches live the moment it changes — passing the new value
  // directly (not reading selectedOrganizationId back from state, which
  // wouldn't have updated yet inside this same handler) rather than waiting
  // for the user to also press "Odśwież" (kept alongside for a plain manual
  // re-sync of the same filter).
  function handleOrganizationChange(organizationId: string) {
    setSelectedOrganizationId(organizationId);
    refreshMatrix(organizationId);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-600 mb-1">
            <Layers className="h-3.5 w-3.5" />
            <span>Matryca logistyczna • Gotowość operacyjna służb i organizacji</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Matryca Zasobów Ratunkowych</h1>
          <p className="text-sm text-slate-500 mt-1">
            Przegląd zasobów organizacji w podziale na kategorie i horyzonty czasowe dostępności.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {refreshError && <p className="text-xs text-rose-600">{refreshError}</p>}
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
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {tiles.map((tile) => {
          const info = getResourceGroupInfo(tile.group);
          const Icon = GROUP_ICON_COMPONENTS[tile.group];
          return (
            <div
              key={tile.group}
              className="rounded-2xl border border-slate-200 bg-white shadow-xs p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold truncate">{info.label}</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">{tile.quantity}</p>
                {/* Secondary metric stays neutral gray on purpose — only the icon carries the group color. */}
                <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  w 24h: {tile.within24h}
                </p>
              </div>
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl shrink-0 ${info.badgeClass}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 pr-1">
            <Filter className="h-3.5 w-3.5" />
            Kategoria:
          </span>
          <button
            type="button"
            onClick={() => setSelectedGroup(null)}
            className={`${CHIP_BASE} ${selectedGroup === null ? ALL_CHIP_ACTIVE : ALL_CHIP_INACTIVE}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Wszystkie
          </button>
          {GROUP_CHIPS.map((group) => {
            const info = getResourceGroupInfo(group);
            const active = selectedGroup === group;
            const Icon = GROUP_ICON_COMPONENTS[group];
            return (
              <button
                key={group}
                type="button"
                onClick={() => setSelectedGroup(active ? null : group)}
                className={`${CHIP_BASE} ${active ? getResourceGroupActiveClass(group) : info.badgeClass + ' hover:brightness-95'}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {info.label}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs px-1">
          <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-500">Posiadacz:</span>
          <span className="relative">
            <select
              value={selectedOrganizationId}
              onChange={(e) => handleOrganizationChange(e.target.value)}
              disabled={refreshing}
              className="appearance-none bg-transparent font-bold text-slate-900 pr-5 py-0.5 cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Wszystkie organizacje ({organizations.length})</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
          </span>
        </label>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Layers className="h-4 w-4 text-slate-400" />
            Tabela Dostępności Zasobów według Horyzontu Czasowego
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
            <Eye className="h-3.5 w-3.5" />
            Kliknij w komórkę, aby zobaczyć zadeklarowane jednostki
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200/80 text-slate-500">
              <tr>
                <th className="py-3 px-4 text-xs uppercase font-bold tracking-wider">Typ zasobu</th>
                {MATRIX_HORIZONS.map((horizon) => (
                  <th key={horizon} className="py-3 px-4">
                    <span className="block text-xs uppercase font-bold tracking-wider text-slate-700">
                      {getHorizonInfo(horizon).label}
                    </span>
                    <span className="block text-[10px] font-medium normal-case text-slate-400">
                      {HORIZON_SUBTITLES[horizon]}
                    </span>
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
                filteredCategories.map((category, idx) => {
                  const groupInfo = getResourceGroupInfo(category.group);
                  const Icon = GROUP_ICON_COMPONENTS[category.group];
                  return (
                    <tr
                      key={category.categoryId}
                      className={`hover:bg-slate-100/70 transition ${idx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${groupInfo.badgeClass}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-semibold text-slate-900 truncate">{category.name}</span>
                            <span className="text-xs text-slate-400">{groupInfo.label}</span>
                          </div>
                        </div>
                      </td>
                      {MATRIX_HORIZONS.map((horizon) => {
                        const cell = category.horizons[horizon];
                        return (
                          <td key={horizon} className="py-1.5 px-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedCell({ category, horizon })}
                              className="w-full rounded-lg bg-slate-50 hover:bg-slate-200/70 px-3 py-2.5 text-left transition"
                            >
                              <span className="text-sm font-bold text-slate-900">{cell.available}</span>
                              <span className="text-xs text-slate-400"> / {cell.quantity}</span>
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
          organizationId={selectedOrganizationId}
          categories={categories}
          currentUserOrganizationId={currentUserOrganizationId}
          isAdmin={isAdmin}
          onChanged={() => refreshMatrix(selectedOrganizationId)}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {showFormModal && (
        <ResourceFormModal
          categories={categories}
          onClose={() => setShowFormModal(false)}
          onCreated={() => refreshMatrix(selectedOrganizationId)}
        />
      )}
    </div>
  );
}
