'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/Pagination';
import { GminaFormModal } from '@/components/gmina/GminaFormModal';
import { GminaCard } from './GminaCard';
import type { GminaListItem } from './types';
import { useAdminEvents } from '@/hooks/useAdminEvents';
import { getCachedList, setCachedList } from '@/lib/adminListCache';

// Encoded as a single "field:direction" value so one <select> can drive both
// — sorting is applied server-side (see GET /api/admin/gminas' sortBy/sortDir),
// not a client-side Array.sort over the current page.
const SORT_OPTIONS = [
  { value: 'name:asc', label: 'Nazwa (A-Z)' },
  { value: 'name:desc', label: 'Nazwa (Z-A)' },
  { value: 'voivodeship:asc', label: 'Województwo (A-Z)' },
  { value: 'voivodeship:desc', label: 'Województwo (Z-A)' },
  { value: 'powiat:asc', label: 'Powiat (A-Z)' },
  { value: 'powiat:desc', label: 'Powiat (Z-A)' },
  { value: 'createdAt:desc', label: 'Data dodania (najnowsze)' },
  { value: 'createdAt:asc', label: 'Data dodania (najstarsze)' },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]['value'];

const PAGE_SIZE = 30;

/** One voivodeship that exists in the system, with the powiats that exist under it. */
interface LocationOption {
  voivodeship: string;
  powiats: string[];
}

/** Shape GET /api/admin/gminas actually returns per row. */
interface ApiGmina {
  id: string;
  name: string;
  powiat: string | null;
  voivodeship: string | null;
  latitude: number | null;
  longitude: number | null;
  _count: {
    users: number;
    resources: number;
    alerts: number;
    inviteTokens: number;
    organizations: number;
  };
}

function mapGmina(gmina: ApiGmina): GminaListItem {
  return {
    id: gmina.id,
    name: gmina.name,
    powiat: gmina.powiat,
    voivodeship: gmina.voivodeship,
    latitude: gmina.latitude,
    longitude: gmina.longitude,
    usersCount: gmina._count.users,
    resourcesCount: gmina._count.resources,
    alertsCount: gmina._count.alerts,
    inviteTokensCount: gmina._count.inviteTokens,
    organizationsCount: gmina._count.organizations,
  };
}

interface CachedGminasPage {
  gminas: GminaListItem[];
  total: number;
  totalPages: number;
}

export function GminasDirectory() {
  const [query, setQuery] = useState('');
  // Debounced, and only what's actually sent to the server — search runs as a
  // DB query (name/powiat/voivodeship), not a client-side filter, so it
  // covers the whole directory instead of whatever page happened to load.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // 'ALL' means no filter. Powiat only ever makes sense once a voivodeship is
  // picked — the options offered for it are scoped to that voivodeship's own
  // powiats below.
  const [voivodeshipFilter, setVoivodeshipFilter] = useState<string>('ALL');
  const [powiatFilter, setPowiatFilter] = useState<string>('ALL');
  const [sort, setSort] = useState<SortValue>('name:asc');
  const [showCreate, setShowCreate] = useState(false);

  const [page, setPage] = useState(1);
  const [gminas, setGminas] = useState<GminaListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  // Voivodeships (and their powiats) that actually exist among current
  // gminas — refreshed on every fetch, so a newly-added voivodeship/powiat
  // shows up without a full page reload.
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Independent of the paginated list fetch below on purpose: these options
  // only change when a gmina is created/edited/deleted, not on every
  // search/sort/page-turn, so this only runs once on mount and again (via
  // refetch(), together with the list) after an actual mutation — not on
  // every keystroke or page click.
  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/gminas/locations');
      const data = await res.json().catch(() => ({}));
      if (res.ok) setLocations((data.locations as LocationOption[]) ?? []);
    } catch (err) {
      console.error('[GminasDirectory] failed to fetch location options:', err);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const powiatsInVoivodeship = useMemo(
    () => locations.find((l) => l.voivodeship === voivodeshipFilter)?.powiats ?? [],
    [locations, voivodeshipFilter]
  );

  // If the voivodeship filter changes (or clears) after a powiat was already
  // picked, that powiat may no longer be valid for the new voivodeship —
  // clear the stale selection rather than silently keep filtering by it.
  useEffect(() => {
    if (powiatFilter !== 'ALL' && !powiatsInVoivodeship.includes(powiatFilter)) {
      setPowiatFilter('ALL');
    }
  }, [powiatFilter, powiatsInVoivodeship]);

  // Guards against a slower earlier response landing after a faster later one
  // (e.g. rapidly switching filters) overwriting fresh results with stale ones.
  const requestIdRef = useRef(0);

  const fetchGminas = useCallback(
    async (targetPage: number, opts?: { allowCache?: boolean }) => {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
      if (voivodeshipFilter !== 'ALL') params.set('voivodeship', voivodeshipFilter);
      if (powiatFilter !== 'ALL') params.set('powiat', powiatFilter);
      if (debouncedQuery) params.set('q', debouncedQuery);
      const [sortBy, sortDir] = sort.split(':');
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      const cacheKey = params.toString();

      // Only ever consulted right after mount (see the effect below) — see
      // lib/adminListCache.ts for why this can't serve stale data.
      if (opts?.allowCache) {
        const cached = getCachedList<CachedGminasPage>('gminas', cacheKey);
        if (cached) {
          setGminas(cached.gminas);
          setTotal(cached.total);
          setTotalPages(cached.totalPages);
          setError(null);
          return;
        }
      }

      const requestId = ++requestIdRef.current;

      try {
        const res = await fetch(`/api/admin/gminas?${cacheKey}`);
        const data = await res.json().catch(() => ({}));

        if (requestId !== requestIdRef.current) return; // superseded by a newer request

        if (!res.ok) {
          setError(data.error ?? 'Nie udało się wczytać gmin.');
          return;
        }

        const serverTotalPages: number = data.totalPages ?? 1;
        // The page we asked for no longer exists for this filter/result set
        // (e.g. it just shrank below the current page after a delete or a
        // narrower filter) — land back on the last real page instead of
        // showing an empty page with a nonzero total.
        if (targetPage > serverTotalPages) {
          setPage(serverTotalPages);
          return;
        }

        const mappedGminas = (data.gminas as ApiGmina[]).map(mapGmina);
        const total = data.total ?? 0;
        setGminas(mappedGminas);
        setTotal(total);
        setTotalPages(serverTotalPages);
        setError(null);
        setCachedList('gminas', cacheKey, { gminas: mappedGminas, total, totalPages: serverTotalPages });
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error('[GminasDirectory] failed to fetch:', err);
        setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
      }
    },
    [voivodeshipFilter, powiatFilter, debouncedQuery, sort]
  );

  // Any filter (or sort) change invalidates the current page number — always
  // land back on page 1 rather than risk showing an out-of-range page for
  // the new, differently-ordered result set.
  useEffect(() => {
    setPage(1);
  }, [voivodeshipFilter, powiatFilter, debouncedQuery, sort]);

  const didMountRef = useRef(false);
  useEffect(() => {
    const allowCache = !didMountRef.current;
    didMountRef.current = true;
    setLoading(true);
    fetchGminas(page, { allowCache }).finally(() => setLoading(false));
  }, [page, fetchGminas]);

  function refetch() {
    setLoading(true);
    Promise.all([fetchGminas(page), fetchLocations()]).finally(() => setLoading(false));
  }

  // Another admin's own create/edit/delete — see AdminEventsBridge (mounted
  // in admin/layout.tsx) for how this arrives.
  useAdminEvents('gminas', refetch);

  const hasActiveFilters = query.trim() !== '' || voivodeshipFilter !== 'ALL' || powiatFilter !== 'ALL';

  function clearFilters() {
    setQuery('');
    setDebouncedQuery('');
    setVoivodeshipFilter('ALL');
    setPowiatFilter('ALL');
  }

  const rangeLabel =
    total === 0 ? '0 wyników' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} z ${total}`;

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-wrap">
          <select
            value={voivodeshipFilter}
            onChange={(e) => setVoivodeshipFilter(e.target.value)}
            className="lg:flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          >
            <option value="ALL">Wszystkie województwa</option>
            {locations.map((l) => (
              <option key={l.voivodeship} value={l.voivodeship}>
                {l.voivodeship}
              </option>
            ))}
          </select>

          <select
            value={powiatFilter}
            onChange={(e) => setPowiatFilter(e.target.value)}
            disabled={voivodeshipFilter === 'ALL'}
            className="lg:flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="ALL">Wszystkie powiaty</option>
            {powiatsInVoivodeship.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortValue)}
            className="lg:flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-wrap pt-3 border-t border-slate-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj po nazwie, powiecie, województwie…"
              className="w-full lg:h-[39px] rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-3 text-sm text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
            />
          </div>

          <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">{rangeLabel}</span>

          <div className="flex items-stretch gap-2 lg:gap-3 w-full lg:w-auto">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex-1 justify-center lg:flex-none lg:shrink-0 inline-flex items-center gap-1.5 px-2 lg:px-3 py-2 lg:h-[39px] rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="h-3.5 w-3.5" />
                <span className="lg:hidden">Wyczyść</span>
                <span className="hidden lg:inline">Wyczyść filtry</span>
              </button>
            )}

            <Button
              type="button"
              size="sm"
              // Alone on its row (no "Wyczyść filtry" next to it), h-auto would
              // shrink it to just its text/icon line — pin it to the search
              // input's own mobile height (py-2.5 + text-sm line-height +
              // border = 42px) so it doesn't look squat next to the input
              // above it. With the clear-filters button present, items-stretch
              // already sizes both to match each other, so h-auto there is
              // left untouched.
              className={`gap-1.5 flex-1 lg:h-[39px] lg:flex-none lg:shrink-0 ${hasActiveFilters ? 'h-auto' : 'h-[38px]'}`}
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-4 w-4" />
              Dodaj gminę
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-600">{error}</div>
      )}

      {loading ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <p className="text-sm text-slate-400">Wczytywanie…</p>
        </div>
      ) : gminas.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <MapPin className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">Brak wyników</h3>
          <p className="text-xs text-slate-400 mt-1">Zmień kryteria wyszukiwania lub filtry.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gminas.map((gmina) => (
            <GminaCard key={gmina.id} gmina={gmina} onChanged={refetch} />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={loading} />

      {showCreate && <GminaFormModal mode="create" onClose={() => setShowCreate(false)} onSuccess={refetch} />}
    </div>
  );
}
