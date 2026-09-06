'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Prisma } from '@prisma/client';
import { SEVERITY_STYLES, SEVERITY_LABELS, SEVERITY_MARKER_COLORS, ALERT_STATUS_LABELS } from '@/lib/alertLabels';
import { formatDate } from '@/lib/utils';
import type { Role } from '@/types';
import AlertForm from './AlertForm';
import AlertActions from './AlertActions';

const AlertMap = dynamic(() => import('./AlertMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">Ładowanie mapy…</div>
  ),
});

const NOWA_DEBA_CENTER: [number, number] = [50.4166, 21.75];

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const STATUSES = ['ACTIVE', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const alertInclude = { gmina: true } satisfies Prisma.AlertInclude;
type AlertWithGmina = Prisma.AlertGetPayload<{ include: typeof alertInclude }>;

export interface GminaOption {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface AlertsMapViewProps {
  initialAlerts: AlertWithGmina[];
  gminy: GminaOption[];
  canManageAlerts: boolean;
  currentUserGminaId: string | null;
  currentUserRole: Role;
}

export default function AlertsMapView({
  initialAlerts,
  gminy,
  canManageAlerts,
  currentUserGminaId,
  currentUserRole,
}: AlertsMapViewProps) {
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set(SEVERITIES));
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(['ACTIVE', 'IN_PROGRESS']));
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'severity'>('newest');
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null);

  const userGmina = gminy.find((g) => g.id === currentUserGminaId);
  const center: [number, number] =
    userGmina?.latitude != null && userGmina?.longitude != null
      ? [userGmina.latitude, userGmina.longitude]
      : NOWA_DEBA_CENTER;

  const filteredAlerts = useMemo(() => {
    const filtered = initialAlerts.filter((a) => severityFilter.has(a.severity) && statusFilter.has(a.status));
    return [...filtered].sort((a, b) => {
      if (sortOrder === 'newest') return b.createdAt.valueOf() - a.createdAt.valueOf();
      if (sortOrder === 'oldest') return a.createdAt.valueOf() - b.createdAt.valueOf();
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    });
  }, [initialAlerts, severityFilter, statusFilter, sortOrder]);

  function toggleInSet(setter: typeof setSeverityFilter, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function handleMapClick(lat: number, lng: number) {
    if (!canManageAlerts) return;
    setPendingCoords({ lat, lng });
    setShowForm(true);
  }

  return (
    <main className="flex-1 px-4 py-8 container mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Mapa Ostrzeżeń Kryzysowych <span className="text-slate-500 font-normal">({filteredAlerts.length})</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {canManageAlerts
              ? 'Kliknij na mapie, aby ustawić lokalizację nowego alertu, lub użyj przycisku poniżej.'
              : 'Podgląd aktywnych ostrzeżeń kryzysowych.'}
          </p>
        </div>
        {canManageAlerts && (
          <button
            type="button"
            onClick={() => {
              setPendingCoords(null);
              setShowForm((v) => !v);
            }}
            className="shrink-0 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            {showForm ? 'Anuluj' : '+ Nowy alert'}
          </button>
        )}
      </div>

      {showForm && canManageAlerts && (
        <div className="mb-6">
          <AlertForm
            gminy={gminy}
            currentUserGminaId={currentUserGminaId}
            currentUserRole={currentUserRole}
            initialCoords={pendingCoords}
            onDone={() => {
              setShowForm(false);
              setPendingCoords(null);
            }}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <FilterGroup
          label="Krytyczność"
          options={SEVERITIES}
          labels={SEVERITY_LABELS}
          active={severityFilter}
          onToggle={(v) => toggleInSet(setSeverityFilter, v)}
        />
        <FilterGroup
          label="Status"
          options={STATUSES}
          labels={ALERT_STATUS_LABELS}
          active={statusFilter}
          onToggle={(v) => toggleInSet(setStatusFilter, v)}
        />
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-slate-500">Sortuj:</label>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
            className="rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-sm px-2 py-1"
          >
            <option value="newest">Najnowsze</option>
            <option value="oldest">Najstarsze</option>
            <option value="severity">Krytyczność</option>
          </select>
        </div>
      </div>

      <div className="relative rounded-xl border border-slate-800 overflow-hidden mb-8" style={{ height: 480 }}>
        <AlertMap
          alerts={filteredAlerts}
          center={center}
          focusedAlertId={focusedAlertId}
          onMapClick={canManageAlerts ? handleMapClick : undefined}
        />
        <div className="absolute bottom-3 left-3 z-[1000] rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-300 backdrop-blur pointer-events-none">
          <p className="font-semibold mb-1.5">Legenda: Krytyczność</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {SEVERITIES.map((sev) => (
              <div key={sev} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: SEVERITY_MARKER_COLORS[sev] }}
                />
                {SEVERITY_LABELS[sev]}
              </div>
            ))}
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-slate-100 mb-4">Lista alertów ({filteredAlerts.length})</h2>
      {filteredAlerts.length === 0 ? (
        <p className="text-sm text-slate-500">Brak alertów spełniających wybrane filtry.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredAlerts.map((alert) => (
            <li
              key={alert.id}
              className={`rounded-lg border px-4 py-3 ${SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.LOW}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{alert.title}</p>
                <span className="text-xs uppercase tracking-wide opacity-80 shrink-0">
                  {ALERT_STATUS_LABELS[alert.status] ?? alert.status}
                </span>
              </div>
              <p className="text-sm opacity-80 mt-1 line-clamp-3">{alert.description}</p>
              <p className="text-xs opacity-60 mt-2">
                {alert.gmina.name}
                {alert.location ? ` · ${alert.location}` : ''} · {formatDate(alert.createdAt)}
              </p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {alert.latitude != null && alert.longitude != null && (
                  <button
                    type="button"
                    onClick={() => setFocusedAlertId(alert.id)}
                    className="text-xs underline underline-offset-2 opacity-90 hover:opacity-100"
                  >
                    Pokaż na mapie
                  </button>
                )}
                {canManageAlerts && (
                  <AlertActions
                    alertId={alert.id}
                    status={alert.status}
                    canDelete={currentUserRole === 'ADMIN'}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  labels,
  active,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  labels: Record<string, string>;
  active: Set<string>;
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-slate-500">{label}:</span>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onToggle(opt)}
          className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
            active.has(opt)
              ? 'border-red-700 bg-red-950/60 text-red-300'
              : 'border-slate-700 text-slate-500 hover:border-slate-600'
          }`}
        >
          {labels[opt] ?? opt}
        </button>
      ))}
    </div>
  );
}
