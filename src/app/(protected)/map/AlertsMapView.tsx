'use client';

import { useMemo, useRef, useState } from 'react';
import { dynamicClientOnly } from '@/lib/dynamicClientOnly';
import Link from 'next/link';
import type { AlertWithRelations } from '@/lib/alertInclude';
import {
  ALERT_STATUS_LABELS,
  ALERT_CATEGORY_LABELS,
  SEVERITY_LABELS,
  CATEGORY_MARKER_COLORS,
  SEVERITY_MARKER_COLORS,
  EVENT_CATEGORIES,
  getSeverityBadgeInfo,
  formatDuration,
  categoriesForKind,
  hexToRgba,
} from '@/lib/alertLabels';
import type { AlertKindValue } from '@/lib/alertLabels';
import { NOWA_DEBA_CENTER } from '@/lib/mapDefaults';
import type { Role } from '@/types';
import { canManageAlert as canManageAlertPolicy, isAlertOwnerOrg } from '@/lib/resourceAuthz';
import { availableCategoryIds, countMatchingNeeds } from '@/lib/resourceMatching';
import type { MapDisplayMode } from './AlertMap';
import AlertForm from './AlertForm';
import AlertActions from './AlertActions';
import AlertEditModal from './AlertEditModal';
import AlertNeedsBlock from './AlertNeedsBlock';
import {
  Radio,
  Building,
  Map as MapIcon,
  MapPin,
  Search,
  X,
  ArrowUpDown,
  Calendar,
  CalendarDays,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Archive,
  Pencil,
  Siren,
  SlidersHorizontal,
  PackageCheck,
  MessageSquare,
} from 'lucide-react';

const AlertMap = dynamicClientOnly(() => import('./AlertMap'), {
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">Ładowanie mapy…</div>
  ),
});

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

// The exact shape of each alert is defined once in lib/alertInclude.ts (shared
// with the /map server page that fetches them) — see the comment there for why
// author/gmina are a narrow `select` and must never become `include: true`.
type AlertWithGmina = AlertWithRelations;

type Timeframe = '24h' | '48h' | '72h' | 'tydzien' | 'miesiac' | 'rok' | 'wszystkie' | 'custom';
type SortOption = 'date-desc' | 'date-asc' | 'severity-desc' | 'severity-asc' | 'name-asc' | 'name-desc';

const TIME_MS = { hour: 3600_000, day: 86_400_000 };

const CLOSED_ALERT_STATUSES = new Set(['RESOLVED', 'CANCELLED']);

interface TimeframeAlert {
  createdAt: Date;
  updatedAt: Date;
  startsAt: Date | null;
  expiresAt: Date | null;
  status: string;
}

// An alert's own active period is [początek, koniec]: początek is startsAt if
// the reporter declared one (e.g. a festival entered today but scheduled to
// run next week), else createdAt (the common "reported now, active now"
// case); koniec is expiresAt if the reporter set one, else updatedAt once the
// alert is closed (RESOLVED/CANCELLED — that status change is what actually
// ended its active period), else null ("still ongoing", no upper bound) for
// an alert that's still ACTIVE/IN_PROGRESS with no declared end. Shared by
// the time filter below and by the "Trwa od"/"Okres zdarzenia" labels on the
// cards, so they never disagree about what an alert's period actually is.
function getAlertPeriod(alert: TimeframeAlert): { start: Date; end: Date | null } {
  const start = alert.startsAt ?? alert.createdAt;
  const end = alert.expiresAt ?? (CLOSED_ALERT_STATUSES.has(alert.status) ? alert.updatedAt : null);
  return { start, end };
}

// A "zakres czasu" filter answers "was this alert/event active at any point
// during the selected window" — not just "when was it reported". Without
// this, a days-old but still-active alert would vanish from "Ostatnie 24h"
// even though it's active right now.
function matchesTimeframe(alert: TimeframeAlert, timeframe: Timeframe, customStart: string, customEnd: string): boolean {
  if (timeframe === 'wszystkie') return true;

  const { start, end } = getAlertPeriod(alert);
  const periodStart = start.getTime();
  const periodEnd = end ? end.getTime() : Infinity;

  if (timeframe === 'custom') {
    const windowStart = customStart ? new Date(customStart).getTime() : -Infinity;
    const windowEnd = customEnd ? new Date(customEnd).getTime() + TIME_MS.day : Infinity;
    return periodStart <= windowEnd && periodEnd >= windowStart;
  }

  const spanDays: Record<Exclude<Timeframe, 'wszystkie' | 'custom'>, number> = {
    '24h': 1,
    '48h': 2,
    '72h': 3,
    tydzien: 7,
    miesiac: 30,
    rok: 365,
  };
  const windowStart = Date.now() - spanDays[timeframe] * TIME_MS.day;
  return periodStart <= Date.now() && periodEnd >= windowStart;
}

function matchesSearch(alert: AlertWithGmina, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return [
    alert.title,
    alert.description,
    alert.location,
    alert.gmina.name,
    alert.author?.name,
    alert.author?.organization?.name,
  ]
    .filter(Boolean)
    .some((field) => field!.toLowerCase().includes(q));
}

function sortAlerts(alerts: AlertWithGmina[], sort: SortOption): AlertWithGmina[] {
  return [...alerts].sort((a, b) => {
    switch (sort) {
      case 'severity-desc':
        return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.createdAt.valueOf() - a.createdAt.valueOf();
      case 'severity-asc':
        return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.createdAt.valueOf() - a.createdAt.valueOf();
      case 'name-asc':
        return a.title.localeCompare(b.title, 'pl');
      case 'name-desc':
        return b.title.localeCompare(a.title, 'pl');
      case 'date-asc':
        return a.createdAt.valueOf() - b.createdAt.valueOf();
      case 'date-desc':
      default:
        return b.createdAt.valueOf() - a.createdAt.valueOf();
    }
  });
}

const TIME_CHIPS_ACTIVE = [
  { key: 'wszystkie', label: 'Wszystkie aktywne' },
  { key: '24h', label: 'Ostatnie 24h' },
  { key: '48h', label: '48h' },
  { key: '72h', label: '72h' },
  { key: 'tydzien', label: 'Tydzień' },
  { key: 'miesiac', label: 'Miesiąc' },
  { key: 'rok', label: 'Rok' },
  { key: 'custom', label: '📅 Własny zakres' },
] as const;

const TIME_CHIPS_ARCHIVE = [
  { key: '24h', label: 'Ostatnie 24h' },
  { key: '48h', label: '48h' },
  { key: '72h', label: '72h' },
  { key: 'tydzien', label: 'Tydzień' },
  { key: 'miesiac', label: 'Miesiąc' },
  { key: 'rok', label: 'Rok' },
  { key: 'wszystkie', label: 'Wszystkie' },
  { key: 'custom', label: '📅 Własny zakres' },
] as const;

type MapTimeRange = '24h' | '48h' | '72h' | 'all';
type MapStatusFilter = 'active' | 'archived' | 'all';

// Krótka wersja zakresu czasowego dla filtrów mapy — celowo tylko 4 opcje
// (bez tygodnia/miesiąca/roku jak w panelach list poniżej), bo mapa służy do
// szybkiego podglądu "co się dzieje teraz", nie do analizy historycznej.
const MAP_TIME_RANGES: { key: MapTimeRange; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '48h', label: '48h' },
  { key: '72h', label: '72h' },
  { key: 'all', label: 'Wszystkie' },
];

const MAP_STATUS_OPTIONS: { key: MapStatusFilter; label: string }[] = [
  { key: 'active', label: 'Aktywne' },
  { key: 'archived', label: 'Zakończone' },
  { key: 'all', label: 'Wszystkie' },
];

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
  currentUserId: string;
  currentUserOrganizationId: string | null;
  // Own organization's resources — feeds the "Masz zasoby (N)" badge (R11,
  // Крок 43/46) via lib/resourceMatching.ts. Not consumed yet: the badge
  // itself is wired into the card markup in Крок 46, alongside <AlertNeedsBlock>.
  myResources: { categoryId: string; quantity: number; reservedQuantity: number }[];
}

// "Forum" icon-link (Крок 58) — deliberately its own small component rather
// than inline JSX in each card block below (active + archived render it
// identically): links to the alert's detail page (alerty/[alertId], Крок
// 55) with a badge showing the total journal entries + replies
// (alert._count.messages, Крок 53/54). Always rendered, for every alert,
// regardless of role or whether AlertNeedsBlock even renders anything —
// unlike the rest of the resource module, the journal/forum is visible to
// everyone who can see the alert at all (розділ 4,
// docs/are-you-familiar-with-tidy-blum.md).
function ForumLinkButton({ alertId, count }: { alertId: string; count: number }) {
  return (
    <Link
      href={`/alerty/${alertId}`}
      title="Dziennik operacyjny i forum komunikatu"
      className="relative flex items-center justify-center h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition shrink-0"
    >
      <MessageSquare className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold leading-none">
          {count}
        </span>
      )}
    </Link>
  );
}

export default function AlertsMapView({
  initialAlerts,
  gminy,
  canManageAlerts,
  currentUserGminaId,
  currentUserRole,
  currentUserId,
  currentUserOrganizationId,
  myResources,
}: AlertsMapViewProps) {
  // "Alerty" jest widokiem domyślnym i ma pierwszeństwo przy wejściu na stronę —
  // zdarzenia codzienne są dodatkiem, nie mogą przesłonić komunikatów kryzysowych.
  const [view, setView] = useState<AlertKindValue>('ALERT');
  const [showMap, setShowMap] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [mapMode, setMapMode] = useState<MapDisplayMode>('severity');
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null);
  const [editingAlert, setEditingAlert] = useState<AlertWithGmina | null>(null);
  const mapSectionRef = useRef<HTMLDivElement>(null);

  // Filtry mapy — niezależne od filtrów list "Aktywne"/"Archiwum" poniżej:
  // te rządzą tym, co pokazują karty, filtry mapy rządzą tylko pinezkami.
  const [mapSearch, setMapSearch] = useState('');
  const [mapStatus, setMapStatus] = useState<MapStatusFilter>('active');
  const [mapTimeRange, setMapTimeRange] = useState<MapTimeRange>('all');
  const [mapSeverities, setMapSeverities] = useState<Set<string>>(new Set(SEVERITIES));
  const [mapCategories, setMapCategories] = useState<Set<string>>(new Set(EVENT_CATEGORIES));

  const [activeSearch, setActiveSearch] = useState('');
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('wszystkie');
  const [activeCustomStart, setActiveCustomStart] = useState('');
  const [activeCustomEnd, setActiveCustomEnd] = useState('');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all');
  const [activeOrgFilter, setActiveOrgFilter] = useState<string>('all');
  const [activeSort, setActiveSort] = useState<SortOption>('date-desc');

  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveTimeframe, setArchiveTimeframe] = useState<Timeframe>('24h');
  const [archiveCustomStart, setArchiveCustomStart] = useState('');
  const [archiveCustomEnd, setArchiveCustomEnd] = useState('');
  const [archiveCategoryFilter, setArchiveCategoryFilter] = useState<string>('all');
  const [archiveOrgFilter, setArchiveOrgFilter] = useState<string>('all');
  const [archiveSort, setArchiveSort] = useState<SortOption>('date-desc');

  const userGmina = gminy.find((g) => g.id === currentUserGminaId);
  const center: [number, number] =
    userGmina?.latitude != null && userGmina?.longitude != null
      ? [userGmina.latitude, userGmina.longitude]
      : NOWA_DEBA_CENTER;

  // Alerty i zdarzenia codzienne leżą w jednej tabeli, więc widok wybiera swój
  // podzbiór po `kind` — dopiero potem działają filtry czasu/kategorii/szukania.
  const kindAlerts = useMemo(() => initialAlerts.filter((a) => a.kind === view), [initialAlerts, view]);

  const activeBase = useMemo(
    () => kindAlerts.filter((a) => a.status === 'ACTIVE' || a.status === 'IN_PROGRESS'),
    [kindAlerts]
  );
  const archivedBase = useMemo(
    () => kindAlerts.filter((a) => a.status === 'RESOLVED' || a.status === 'CANCELLED'),
    [kindAlerts]
  );

  const availableActiveOrgs = useMemo(
    () => Array.from(new Set(activeBase.map((a) => a.author?.organization?.name).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b, 'pl')),
    [activeBase]
  );
  const availableArchiveOrgs = useMemo(
    () => Array.from(new Set(archivedBase.map((a) => a.author?.organization?.name).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b, 'pl')),
    [archivedBase]
  );

  const activeAlerts = useMemo(() => {
    const filtered = activeBase.filter(
      (a) =>
        matchesTimeframe(a, activeTimeframe, activeCustomStart, activeCustomEnd) &&
        (activeCategoryFilter === 'all' || a.category === activeCategoryFilter) &&
        (activeOrgFilter === 'all' || a.author?.organization?.name === activeOrgFilter) &&
        matchesSearch(a, activeSearch)
    );
    return sortAlerts(filtered, activeSort);
  }, [activeBase, activeTimeframe, activeCustomStart, activeCustomEnd, activeCategoryFilter, activeOrgFilter, activeSearch, activeSort]);

  const archivedAlerts = useMemo(() => {
    const filtered = archivedBase.filter(
      (a) =>
        matchesTimeframe(a, archiveTimeframe, archiveCustomStart, archiveCustomEnd) &&
        (archiveCategoryFilter === 'all' || a.category === archiveCategoryFilter) &&
        (archiveOrgFilter === 'all' || a.author?.organization?.name === archiveOrgFilter) &&
        matchesSearch(a, archiveSearch)
    );
    return sortAlerts(filtered, archiveSort);
  }, [archivedBase, archiveTimeframe, archiveCustomStart, archiveCustomEnd, archiveCategoryFilter, archiveOrgFilter, archiveSearch, archiveSort]);

  const isEventView = view === 'EVENT';

  // Zbiór pinezek widocznych na mapie — osobny od list "Aktywne"/"Archiwum"
  // poniżej, więc zawężenie mapy (np. do 24h) nie chowa nic z list i odwrotnie.
  const mapAlerts = useMemo(() => {
    return kindAlerts.filter((a) => {
      if (mapStatus === 'active' && !(a.status === 'ACTIVE' || a.status === 'IN_PROGRESS')) return false;
      if (mapStatus === 'archived' && !(a.status === 'RESOLVED' || a.status === 'CANCELLED')) return false;
      if (!matchesTimeframe(a, mapTimeRange === 'all' ? 'wszystkie' : mapTimeRange, '', '')) return false;
      if (isEventView ? !mapCategories.has(a.category) : !mapSeverities.has(a.severity)) return false;
      if (!matchesSearch(a, mapSearch)) return false;
      return true;
    });
  }, [kindAlerts, mapStatus, mapTimeRange, mapSeverities, mapCategories, mapSearch, isEventView]);

  const mapFiltersActive =
    mapSearch.trim() !== '' ||
    mapStatus !== 'active' ||
    mapTimeRange !== 'all' ||
    mapSeverities.size !== SEVERITIES.length ||
    mapCategories.size !== EVENT_CATEGORIES.length;

  function resetMapFilters() {
    setMapSearch('');
    setMapStatus('active');
    setMapTimeRange('all');
    setMapSeverities(new Set(SEVERITIES));
    setMapCategories(new Set(EVENT_CATEGORIES));
  }

  function toggleMapSeverity(value: string) {
    setMapSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleMapCategory(value: string) {
    setMapCategories((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  // Kategorie są rozłączne między widokami, więc filtr wybrany dla alertów nie
  // pasowałby do zdarzeń (i dawał pustą listę) — przy przełączeniu resetujemy go.
  function switchView(next: AlertKindValue) {
    if (next === view) return;
    setView(next);
    setActiveCategoryFilter('all');
    setArchiveCategoryFilter('all');
    setActiveOrgFilter('all');
    setArchiveOrgFilter('all');
    setFocusedAlertId(null);
    setShowForm(false);
    resetMapFilters();
  }

  function handleFocusOnMap(alertId: string) {
    setShowMap(true);
    // Karta może wskazywać na alert spoza aktualnych filtrów mapy (np. wpis
    // archiwalny przy filtrze "Aktywne") — resetujemy je, żeby pinezka na
    // pewno się pojawiła i dało się ją faktycznie pokazać.
    resetMapFilters();
    setFocusedAlertId(alertId);
    setTimeout(() => mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  // Odwrotny kierunek do handleFocusOnMap powyżej — z popupu na pinezce
  // ("Przejdź do kartki zdarzenia") do odpowiadającej karty na liście
  // Aktywne/Archiwum. Alert może być poza aktualnymi filtrami tej listy (np.
  // szukanie/kategoria/organizacja), więc resetujemy te, które mogłyby go
  // ukryć, zanim spróbujemy przewinąć do jego karty.
  function handleGoToCard(alertId: string) {
    const alert = kindAlerts.find((a) => a.id === alertId);
    if (!alert) return;

    const isArchived = alert.status === 'RESOLVED' || alert.status === 'CANCELLED';
    if (isArchived) {
      setArchiveSearch('');
      setArchiveTimeframe('wszystkie');
      setArchiveCategoryFilter('all');
      setArchiveOrgFilter('all');
    } else {
      setActiveSearch('');
      setActiveTimeframe('wszystkie');
      setActiveCategoryFilter('all');
      setActiveOrgFilter('all');
    }

    setTimeout(
      () => document.getElementById(`alert-card-${alertId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      80
    );
  }

  function canManageAlert(alert: AlertWithGmina): boolean {
    if (!canManageAlerts) return false;
    return canManageAlertPolicy(alert, {
      role: currentUserRole,
      organizationId: currentUserOrganizationId,
    });
  }

  // Owner org (or ADMIN) only — gates "Edytuj zapotrzebowanie" (Крок 42), the
  // same rule PATCH/DELETE /api/needs/[id] (Крок 22) enforces server-side.
  function canManageNeedsForAlert(alert: AlertWithGmina): boolean {
    if (!canManageAlerts) return false;
    if (currentUserRole === 'ADMIN') return true;
    return isAlertOwnerOrg(alert, { organizationId: currentUserOrganizationId });
  }

  const ownedCategoryIds = useMemo(() => availableCategoryIds(myResources), [myResources]);
  const canAllocateResources = canManageAlerts && !!currentUserOrganizationId;

  const canDelete = currentUserRole === 'ADMIN';
  const alertCount = useMemo(
    () => initialAlerts.filter((a) => a.kind === 'ALERT' && (a.status === 'ACTIVE' || a.status === 'IN_PROGRESS')).length,
    [initialAlerts]
  );
  const eventCount = useMemo(
    () => initialAlerts.filter((a) => a.kind === 'EVENT' && (a.status === 'ACTIVE' || a.status === 'IN_PROGRESS')).length,
    [initialAlerts]
  );

  return (
    <main className="flex-1 px-4 py-8 container mx-auto space-y-6">
      {/* Nagłówek strony */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div
            className={`flex items-center gap-2 font-semibold text-xs tracking-wider uppercase mb-1 ${
              isEventView ? 'text-fuchsia-600' : 'text-indigo-600'
            }`}
          >
            {isEventView ? (
              <CalendarDays className="h-4 w-4 text-fuchsia-600" />
            ) : (
              <Radio className="h-4 w-4 text-red-500 animate-pulse" />
            )}
            <span>
              {isEventView
                ? 'Życie Miasta • Wydarzenia i Archiwum'
                : 'Panel Operacyjny • Zarządzanie i Archiwum Zdarzeń'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            {isEventView ? 'Zdarzenia Codzienne' : 'Alerty i Ostrzeżenia Kryzysowe'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {isEventView
              ? canManageAlerts
                ? 'Dodawaj festyny, koncerty i zebrania przez formularz poniżej, zarządzaj nimi i przeglądaj archiwum.'
                : 'Festyny, koncerty i inne wydarzenia w mieście — podgląd na mapie oraz archiwum.'
              : canManageAlerts
              ? 'Publikuj komunikaty przez formularz poniżej, zarządzaj ich statusem i przeglądaj archiwum.'
              : 'Podgląd aktywnych ostrzeżeń kryzysowych i archiwum komunikatów.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowMap((v) => !v)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition shadow-xs ${
              showMap ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <MapIcon className="h-4 w-4" />
            <span>{showMap ? 'Ukryj Mapę' : 'Pokaż Mapę'}</span>
          </button>
        </div>
      </div>

      {/* Przełącznik rodzaju wpisów — nad mapą, "Alerty" domyślnie aktywne */}
      <div className="flex items-center gap-2 rounded-2xl bg-white border border-slate-200 p-1.5 w-full sm:w-auto sm:inline-flex shadow-xs">
        <button
          type="button"
          onClick={() => switchView('ALERT')}
          aria-pressed={!isEventView}
          className={`flex flex-1 sm:flex-none items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
            !isEventView
              ? 'bg-red-600 text-white shadow-md shadow-red-600/20'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
          }`}
          title="Komunikaty i ostrzeżenia kryzysowe"
        >
          <Siren className="h-4 w-4" />
          <span>Alerty</span>
          <span
            className={`ml-0.5 rounded-lg px-1.5 py-0.5 text-[10px] font-extrabold ${
              !isEventView ? 'bg-red-800/70 text-red-100' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {alertCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => switchView('EVENT')}
          aria-pressed={isEventView}
          className={`flex flex-1 sm:flex-none items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
            isEventView
              ? 'bg-fuchsia-600 text-white shadow-md shadow-fuchsia-600/20'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
          }`}
          title="Festyny, koncerty, zebrania i inne wydarzenia w mieście"
        >
          <CalendarDays className="h-4 w-4" />
          <span>Zdarzenia codzienne</span>
          <span
            className={`ml-0.5 rounded-lg px-1.5 py-0.5 text-[10px] font-extrabold ${
              isEventView ? 'bg-fuchsia-800/70 text-fuchsia-100' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {eventCount}
          </span>
        </button>
      </div>

      {/* Filtry mapy — zawężają wyłącznie pinezki na mapie poniżej; listy kart
          "Aktywne"/"Archiwum" dalej na stronie mają własne, niezależne filtry. */}
      {showMap && (
        <div className="rounded-3xl bg-white border border-slate-200 shadow-xs p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Filtry mapy</span>
            </div>
            {mapFiltersActive && (
              <button
                type="button"
                onClick={resetMapFilters}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 transition"
              >
                <X className="h-3 w-3" />
                <span>Wyczyść filtry</span>
              </button>
            )}
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={mapSearch}
                onChange={(e) => setMapSearch(e.target.value)}
                placeholder={isEventView ? 'Szukaj wydarzeń na mapie...' : 'Szukaj alertów na mapie...'}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-9 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
              {mapSearch && (
                <button
                  type="button"
                  onClick={() => setMapSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1 shrink-0">
              {MAP_STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMapStatus(opt.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    mapStatus === opt.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1 shrink-0">
              {MAP_TIME_RANGES.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMapTimeRange(opt.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    mapTimeRange === opt.key
                      ? isEventView
                        ? 'bg-fuchsia-600 text-white shadow-xs'
                        : 'bg-red-600 text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1 shrink-0">
              {isEventView ? 'Typ wydarzenia:' : 'Krytyczność:'}
            </span>
            {(isEventView ? EVENT_CATEGORIES : SEVERITIES).map((key) => {
              const selected = isEventView ? mapCategories.has(key) : mapSeverities.has(key);
              const color = isEventView ? CATEGORY_MARKER_COLORS[key] : SEVERITY_MARKER_COLORS[key];
              const label = isEventView ? ALERT_CATEGORY_LABELS[key] : SEVERITY_LABELS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => (isEventView ? toggleMapCategory(key) : toggleMapSeverity(key))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                    selected ? 'border-transparent text-white' : 'border-slate-200 text-slate-500 hover:text-slate-700'
                  }`}
                  style={selected ? { backgroundColor: color } : undefined}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: selected ? 'rgba(255,255,255,0.9)' : color }}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Mapa */}
      {showMap && (
        <section
          ref={mapSectionRef}
          className="rounded-3xl bg-white p-5 border border-slate-200 shadow-xs space-y-3 scroll-mt-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <MapPin className={`h-4 w-4 ${isEventView ? 'text-fuchsia-600' : 'text-red-500'}`} />
              <span>
                {isEventView
                  ? `Wydarzenia w mieście na mapie (${mapAlerts.length})`
                  : `Lokalizacja zdarzeń na mapie (${mapAlerts.length})`}
              </span>
            </div>
            <span className="text-xs text-slate-500 hidden sm:inline">Kliknij pinezkę, aby zobaczyć szczegóły</span>
          </div>

          <AlertMap
            alerts={mapAlerts}
            center={center}
            height="504px"
            focusedAlertId={focusedAlertId}
            mode={mapMode}
            onModeChange={setMapMode}
            kind={view}
            onGoToCard={handleGoToCard}
          />
        </section>
      )}

      {/* Formularz dodawania alertu */}
      {canManageAlerts && (
        <>
          {!showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="w-full rounded-3xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 p-4 text-sm font-semibold text-slate-500 hover:text-slate-700 transition"
            >
              {isEventView ? '+ Dodaj nowe zdarzenie codzienne' : '+ Opublikuj nowy komunikat kryzysowy'}
            </button>
          )}
          {showForm && (
            <AlertForm
              key={view}
              gminy={gminy}
              currentUserGminaId={currentUserGminaId}
              currentUserRole={currentUserRole}
              initialCoords={null}
              kind={view}
              onDone={() => setShowForm(false)}
              onCancel={() => setShowForm(false)}
            />
          )}
        </>
      )}

      {/* Sekcja aktywnych komunikatów */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            {isEventView ? (
              <span className="inline-flex h-3 w-3 rounded-full bg-fuchsia-500" />
            ) : (
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
              </span>
            )}
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              {isEventView
                ? `Aktualne Wydarzenia (${activeAlerts.length})`
                : `Aktywne Komunikaty (${activeAlerts.length})`}
            </h2>
          </div>
          {isEventView ? (
            <span className="text-xs text-fuchsia-700 font-semibold bg-fuchsia-50 px-3 py-1 rounded-full border border-fuchsia-200">
              Trwające i zaplanowane
            </span>
          ) : (
            <span className="text-xs text-red-700 font-semibold bg-red-50 px-3 py-1 rounded-full border border-red-200">
              Na żywo na tablicy
            </span>
          )}
        </div>

        <div className="rounded-3xl bg-white p-5 border border-slate-200 shadow-xs space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Calendar className={`h-3.5 w-3.5 ${isEventView ? 'text-fuchsia-600' : 'text-red-500'}`} />
              <span>{isEventView ? 'Zakres Czasowy Wydarzeń:' : 'Zakres Czasowy Aktywnych:'}</span>
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {TIME_CHIPS_ACTIVE.map((tf) => (
                <button
                  key={tf.key}
                  type="button"
                  onClick={() => setActiveTimeframe(tf.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    activeTimeframe === tf.key
                      ? isEventView
                        ? 'bg-fuchsia-600 text-white shadow-xs'
                        : 'bg-red-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            {activeTimeframe === 'custom' && (
              <div className="flex items-center gap-3 pt-2 flex-wrap text-xs bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <span className="text-slate-500 font-semibold">Od:</span>
                <input
                  type="date"
                  value={activeCustomStart}
                  onChange={(e) => setActiveCustomStart(e.target.value)}
                  className="rounded-lg bg-white border border-slate-200 py-1 px-2.5 text-slate-900 font-semibold"
                />
                <span className="text-slate-500 font-semibold">Do:</span>
                <input
                  type="date"
                  value={activeCustomEnd}
                  onChange={(e) => setActiveCustomEnd(e.target.value)}
                  className="rounded-lg bg-white border border-slate-200 py-1 px-2.5 text-slate-900 font-semibold"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t border-slate-100">
            <div className="md:col-span-5 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={activeSearch}
                onChange={(e) => setActiveSearch(e.target.value)}
                placeholder="Szukaj wśród aktywnych po treści, miejscu, autorze, organizacji..."
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-10 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:border-red-500 focus:outline-none"
              />
              {activeSearch && (
                <button onClick={() => setActiveSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="md:col-span-2">
              <select
                value={activeCategoryFilter}
                onChange={(e) => setActiveCategoryFilter(e.target.value)}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3 text-xs text-slate-700 font-semibold focus:bg-white focus:border-red-500 focus:outline-none"
              >
                <option value="all">Wszystkie typy</option>
                {categoriesForKind(view).map((c) => (
                  <option key={c} value={c}>
                    {ALERT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                value={activeOrgFilter}
                onChange={(e) => setActiveOrgFilter(e.target.value)}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3 text-xs text-slate-700 font-semibold focus:bg-white focus:border-red-500 focus:outline-none"
              >
                <option value="all">Wszystkie organizacje</option>
                {availableActiveOrgs.map((org) => (
                  <option key={org} value={org}>
                    {org}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                <ArrowUpDown className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <select
                  value={activeSort}
                  onChange={(e) => setActiveSort(e.target.value as SortOption)}
                  className="bg-transparent text-xs text-slate-700 font-semibold focus:outline-none w-full cursor-pointer"
                >
                  <option value="date-desc">Data: Od najnowszych</option>
                  <option value="date-asc">Data: Od najstarszych</option>
                  <option value="severity-desc">🚨 Krytyczność (najwyższa)</option>
                  <option value="severity-asc">🟢 Krytyczność (najniższa)</option>
                  <option value="name-asc">Nazwa: A-Z</option>
                  <option value="name-desc">Nazwa: Z-A</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {activeAlerts.length === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center border border-slate-200 shadow-xs">
            {isEventView ? (
              <CalendarDays className="h-10 w-10 text-fuchsia-500 mx-auto mb-2 opacity-80" />
            ) : (
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2 opacity-80" />
            )}
            <p className="text-slate-800 font-semibold text-sm">
              {activeSearch || activeCategoryFilter !== 'all' || activeOrgFilter !== 'all' || activeTimeframe !== 'wszystkie'
                ? isEventView
                  ? 'Brak wydarzeń spełniających wybrane kryteria'
                  : 'Brak aktywnych ostrzeżeń spełniających wybrane kryteria'
                : isEventView
                ? 'Brak zaplanowanych wydarzeń'
                : 'Brak aktywnych ostrzeżeń'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {activeSearch || activeCategoryFilter !== 'all' || activeOrgFilter !== 'all' || activeTimeframe !== 'wszystkie'
                ? 'Spróbuj zmienić parametry filtrów lub wyczyścić wyszukiwanie.'
                : isEventView
                ? 'Użyj powyższego formularza, aby dodać festyn, koncert lub zebranie.'
                : 'Użyj powyższego formularza, aby opublikować nowy alert.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {activeAlerts.map((alert) => {
              const severityInfo = getSeverityBadgeInfo(alert.severity);
              // Zdarzenia codzienne: "Dodano" zawsze liczy się od createdAt
              // (kiedy wpis trafił do systemu — osobna informacja od tego,
              // kiedy się faktycznie odbywa). Alerty: "Trwa od"/"Rozpocznie
              // się za" liczy się od zadeklarowanego zakresu (startsAt), nie
              // od createdAt — inaczej alert z przyszłym startsAt mylnie
              // wyglądałby na już trwający.
              const { start: effectiveStart } = getAlertPeriod(alert);
              const startsInFuture = !isEventView && effectiveStart.getTime() > Date.now();
              const liveDurationMs = isEventView
                ? Date.now() - alert.createdAt.getTime()
                : Math.abs(Date.now() - effectiveStart.getTime());

              const eventColor = CATEGORY_MARKER_COLORS[alert.category] ?? CATEGORY_MARKER_COLORS.OTHER_EVENT;
              const matchingNeedsCount = countMatchingNeeds(alert.needs, ownedCategoryIds);
              const isOwnerOrg = isAlertOwnerOrg(alert, { organizationId: currentUserOrganizationId });
              const openAllocationCount = alert.needs
                .flatMap((need) => need.allocations)
                .filter((a) => a.status !== 'RETURNED' && a.status !== 'CANCELLED').length;

              return (
                <div
                  key={alert.id}
                  id={`alert-card-${alert.id}`}
                  className={`rounded-3xl bg-white p-6 shadow-xs border hover:shadow-md transition duration-200 flex flex-col justify-between space-y-4 scroll-mt-6 ${
                    isEventView
                      ? 'border-slate-200 hover:border-fuchsia-300'
                      : 'border-red-200 hover:border-red-300'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {!isEventView && (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-xs font-extrabold border uppercase tracking-wider ${severityInfo.badgeClass}`}
                          >
                            <span className={`h-2 w-2 rounded-full ${severityInfo.dotClass}`} />
                            <span>{SEVERITY_LABELS[alert.severity] ?? alert.severity}</span>
                          </span>
                        )}

                        {/* Zdarzenia codzienne: odznaka w kolorze typu wydarzenia, tym samym
                            co pinezka na mapie. Alerty: neutralna odznaka kategorii. */}
                        {isEventView ? (
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-xs font-bold border uppercase tracking-wider"
                            style={{
                              backgroundColor: hexToRgba(eventColor, 0.18),
                              color: eventColor,
                              borderColor: hexToRgba(eventColor, 0.4),
                            }}
                          >
                            <CalendarDays className="h-3 w-3" />
                            {ALERT_CATEGORY_LABELS[alert.category] ?? alert.category}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider">
                            <AlertTriangle className="h-3 w-3 text-slate-500" />
                            {ALERT_CATEGORY_LABELS[alert.category] ?? alert.category}
                          </span>
                        )}

                        {alert.status === 'IN_PROGRESS' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-700 text-xs font-bold uppercase tracking-wider">
                            {ALERT_STATUS_LABELS.IN_PROGRESS}
                          </span>
                        )}

                        {matchingNeedsCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold uppercase tracking-wider">
                            <PackageCheck className="h-3 w-3" />
                            Masz zasoby ({matchingNeedsCount})
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleFocusOnMap(alert.id)}
                        className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-xl font-medium border border-slate-200 transition"
                        title="Pokaż tę lokalizację na mapie"
                      >
                        <MapPin className="h-3.5 w-3.5 text-red-500 shrink-0" />
                        <span>
                          <strong>{alert.location || alert.gmina.name}</strong>
                        </span>
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-base sm:text-lg font-extrabold text-slate-900 leading-snug tracking-tight">
                        {alert.title}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">{alert.description}</p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1">
                        <Building className="h-3.5 w-3.5 text-slate-500" />
                        <span>{alert.author?.organization?.name || alert.gmina.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-indigo-700 font-mono font-semibold">
                        <Clock className="h-3.5 w-3.5 text-indigo-600" />
                        <span>
                          {isEventView
                            ? `Dodano: ${formatDuration(liveDurationMs)} temu`
                            : startsInFuture
                            ? `Rozpocznie się za: ${formatDuration(liveDurationMs)}`
                            : `Trwa od: ${formatDuration(liveDurationMs)}`}
                        </span>
                      </div>
                    </div>

                    <AlertNeedsBlock
                      alertId={alert.id}
                      alertLocationLabel={alert.location || alert.gmina.name}
                      alertDescription={alert.description}
                      alertStatus={alert.status}
                      needs={alert.needs.map((need) => ({
                        ...need,
                        allocations: need.allocations.map((allocation) => ({
                          id: allocation.id,
                          quantity: allocation.quantity,
                          unit: allocation.unit,
                          status: allocation.status,
                          donorOrgId: allocation.donorOrgId,
                          donorOrgName: allocation.donorOrg.name,
                          createdByName: allocation.createdBy?.name ?? null,
                          createdAt: allocation.createdAt,
                        })),
                      }))}
                      canManageNeeds={canManageNeedsForAlert(alert)}
                      canAllocate={canAllocateResources}
                      currentUserRole={currentUserRole}
                      currentUserOrganizationId={currentUserOrganizationId}
                      alertOrganizationId={alert.organizationId}
                      ownedCategoryIds={ownedCategoryIds}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handleFocusOnMap(alert.id)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold border border-indigo-200 transition shrink-0"
                      title="Zlokalizuj to zdarzenie na mapie"
                    >
                      <MapPin className="h-3.5 w-3.5 text-indigo-600" />
                      <span>Na mapie</span>
                    </button>

                    <ForumLinkButton alertId={alert.id} count={alert._count.messages} />

                    {canManageAlert(alert) && (
                      <button
                        type="button"
                        onClick={() => setEditingAlert(alert)}
                        className="flex items-center gap-1 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition shrink-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Edytuj</span>
                      </button>
                    )}

                    <AlertActions
                      alertId={alert.id}
                      alertTitle={alert.title}
                      status={alert.status}
                      kind={alert.kind}
                      canManage={canManageAlert(alert)}
                      canDelete={canDelete}
                      isOwnerOrg={isOwnerOrg}
                      openAllocationCount={openAllocationCount}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sekcja zarchiwizowanych komunikatów */}
      <section className="space-y-4 pt-6 border-t border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5 text-slate-500">
            <Archive className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              {isEventView
                ? `Archiwum Wydarzeń (${archivedAlerts.length})`
                : `Archiwum Komunikatów (${archivedAlerts.length})`}
            </h2>
          </div>
          <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
            Wyszukiwanie i historia
          </span>
        </div>

        <div className="rounded-3xl bg-white p-5 border border-slate-200 shadow-xs space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-indigo-600" />
              <span>Zakres Czasowy Archiwum:</span>
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {TIME_CHIPS_ARCHIVE.map((tf) => (
                <button
                  key={tf.key}
                  type="button"
                  onClick={() => setArchiveTimeframe(tf.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    archiveTimeframe === tf.key ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            {archiveTimeframe === 'custom' && (
              <div className="flex items-center gap-3 pt-2 flex-wrap text-xs bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <span className="text-slate-500 font-semibold">Od:</span>
                <input
                  type="date"
                  value={archiveCustomStart}
                  onChange={(e) => setArchiveCustomStart(e.target.value)}
                  className="rounded-lg bg-white border border-slate-200 py-1 px-2.5 text-slate-900 font-semibold"
                />
                <span className="text-slate-500 font-semibold">Do:</span>
                <input
                  type="date"
                  value={archiveCustomEnd}
                  onChange={(e) => setArchiveCustomEnd(e.target.value)}
                  className="rounded-lg bg-white border border-slate-200 py-1 px-2.5 text-slate-900 font-semibold"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t border-slate-100">
            <div className="md:col-span-5 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={archiveSearch}
                onChange={(e) => setArchiveSearch(e.target.value)}
                placeholder="Szukaj w archiwum po treści, miejscu, autorze, organizacji..."
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-10 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
              {archiveSearch && (
                <button onClick={() => setArchiveSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="md:col-span-2">
              <select
                value={archiveCategoryFilter}
                onChange={(e) => setArchiveCategoryFilter(e.target.value)}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3 text-xs text-slate-700 font-semibold focus:bg-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="all">Wszystkie typy</option>
                {categoriesForKind(view).map((c) => (
                  <option key={c} value={c}>
                    {ALERT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                value={archiveOrgFilter}
                onChange={(e) => setArchiveOrgFilter(e.target.value)}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3 text-xs text-slate-700 font-semibold focus:bg-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="all">Wszystkie organizacje</option>
                {availableArchiveOrgs.map((org) => (
                  <option key={org} value={org}>
                    {org}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                <ArrowUpDown className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                <select
                  value={archiveSort}
                  onChange={(e) => setArchiveSort(e.target.value as SortOption)}
                  className="bg-transparent text-xs text-slate-700 font-semibold focus:outline-none w-full cursor-pointer"
                >
                  <option value="date-desc">Data: Od najnowszych</option>
                  <option value="date-asc">Data: Od najstarszych</option>
                  <option value="severity-desc">🚨 Krytyczność (najwyższa)</option>
                  <option value="severity-asc">🟢 Krytyczność (najniższa)</option>
                  <option value="name-asc">Nazwa: A-Z</option>
                  <option value="name-desc">Nazwa: Z-A</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {archivedAlerts.length === 0 ? (
          <div className="rounded-3xl bg-white p-10 text-center border border-slate-200 shadow-xs space-y-2">
            <Archive className="h-8 w-8 text-slate-400 mx-auto" />
            <p className="text-sm text-slate-800 font-semibold">
              {isEventView
                ? 'Brak zakończonych wydarzeń w wybranym przedziale'
                : 'Brak zarchiwizowanych komunikatów w wybranym przedziale'}
            </p>
            <p className="text-xs text-slate-500">Zmień zakres czasu (np. Tydzień, Miesiąc, Wszystkie) lub zresetuj filtry wyszukiwania.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {archivedAlerts.map((alert) => {
              const severityInfo = getSeverityBadgeInfo(alert.severity);
              const archivedPeriod = getAlertPeriod(alert);
              const archivedPeriodEnd = archivedPeriod.end ?? alert.updatedAt;
              const durationMs = archivedPeriodEnd.getTime() - archivedPeriod.start.getTime();
              const isResolved = alert.status === 'RESOLVED';
              const matchingNeedsCount = countMatchingNeeds(alert.needs, ownedCategoryIds);
              const isOwnerOrg = isAlertOwnerOrg(alert, { organizationId: currentUserOrganizationId });
              const openAllocationCount = alert.needs
                .flatMap((need) => need.allocations)
                .filter((a) => a.status !== 'RETURNED' && a.status !== 'CANCELLED').length;

              return (
                <div
                  key={alert.id}
                  id={`alert-card-${alert.id}`}
                  className="rounded-3xl bg-white p-6 border border-slate-200 hover:border-slate-300 hover:shadow-md transition duration-200 space-y-3.5 flex flex-col justify-between scroll-mt-6"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {!isEventView && (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-xs font-extrabold border uppercase tracking-wider ${severityInfo.badgeClass}`}
                          >
                            <span className={`h-2 w-2 rounded-full ${severityInfo.dotClass}`} />
                            <span>{SEVERITY_LABELS[alert.severity] ?? alert.severity}</span>
                          </span>
                        )}

                        <span className="rounded-xl bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 font-bold uppercase tracking-wider">
                          {ALERT_CATEGORY_LABELS[alert.category] ?? alert.category}
                        </span>

                        {matchingNeedsCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold uppercase tracking-wider">
                            <PackageCheck className="h-3 w-3" />
                            Masz zasoby ({matchingNeedsCount})
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-lg border flex items-center gap-1 ${
                          isResolved
                            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                            : 'text-slate-500 bg-slate-100 border-slate-200'
                        }`}
                      >
                        <span>{isResolved ? '✓' : '✕'} {ALERT_STATUS_LABELS[alert.status] ?? alert.status}</span>
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-base sm:text-lg font-extrabold text-slate-900 leading-snug tracking-tight">
                        {alert.title}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">{alert.description}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-lg">
                        <MapPin className="h-3.5 w-3.5 text-red-500" />
                        <strong>{alert.location || alert.gmina.name}</strong>
                      </span>
                      <span className="flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-lg text-slate-500">
                        <Building className="h-3.5 w-3.5 text-slate-500" />
                        <span>{alert.author?.organization?.name || alert.gmina.name}</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs font-mono">
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-0.5">
                        <span className="text-[10px] text-slate-500 font-sans block">Czas trwania:</span>
                        <span className="text-xs font-extrabold text-indigo-700">{formatDuration(durationMs)}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-0.5">
                        <span className="text-[10px] text-slate-500 font-sans block">Okres zdarzenia:</span>
                        <span className="text-[11px] font-bold text-slate-600">
                          {archivedPeriod.start.toLocaleDateString('pl-PL')} ➔ {archivedPeriodEnd.toLocaleDateString('pl-PL')}
                        </span>
                      </div>
                    </div>

                    <AlertNeedsBlock
                      alertId={alert.id}
                      alertLocationLabel={alert.location || alert.gmina.name}
                      alertDescription={alert.description}
                      alertStatus={alert.status}
                      needs={alert.needs.map((need) => ({
                        ...need,
                        allocations: need.allocations.map((allocation) => ({
                          id: allocation.id,
                          quantity: allocation.quantity,
                          unit: allocation.unit,
                          status: allocation.status,
                          donorOrgId: allocation.donorOrgId,
                          donorOrgName: allocation.donorOrg.name,
                          createdByName: allocation.createdBy?.name ?? null,
                          createdAt: allocation.createdAt,
                        })),
                      }))}
                      canManageNeeds={canManageNeedsForAlert(alert)}
                      canAllocate={canAllocateResources}
                      currentUserRole={currentUserRole}
                      currentUserOrganizationId={currentUserOrganizationId}
                      alertOrganizationId={alert.organizationId}
                      ownedCategoryIds={ownedCategoryIds}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => handleFocusOnMap(alert.id)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold border border-indigo-200 transition"
                      title="Zlokalizuj to zdarzenie na mapie"
                    >
                      <MapPin className="h-3.5 w-3.5 text-indigo-600" />
                      <span>Na mapie</span>
                    </button>

                    <ForumLinkButton alertId={alert.id} count={alert._count.messages} />

                    {canManageAlert(alert) && (
                      <button
                        type="button"
                        onClick={() => setEditingAlert(alert)}
                        className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Edytuj</span>
                      </button>
                    )}

                    <AlertActions
                      alertId={alert.id}
                      alertTitle={alert.title}
                      status={alert.status}
                      kind={alert.kind}
                      canManage={canManageAlert(alert)}
                      canDelete={canDelete}
                      isOwnerOrg={isOwnerOrg}
                      openAllocationCount={openAllocationCount}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editingAlert && <AlertEditModal alert={editingAlert} onClose={() => setEditingAlert(null)} />}
    </main>
  );
}
