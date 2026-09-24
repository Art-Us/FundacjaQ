'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Building2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/Pagination';
import { OrganizationFormModal } from '@/components/organization/OrganizationFormModal';
import type { GminaOption } from '@/components/gmina/GminaSelect';
import { OrganizationCard } from './OrganizationCard';
import type { OrganizationListItem } from './types';
import { useAdminEvents } from '@/hooks/useAdminEvents';
import { getCachedList, setCachedList } from '@/lib/adminListCache';

// Encoded as a single "field:direction" value so one <select> can drive both
// — sorting is applied server-side (see GET /api/admin/organizations'
// sortBy/sortDir), not a client-side Array.sort over the current page.
const SORT_OPTIONS = [
  { value: 'name:asc', label: 'Nazwa (A-Z)' },
  { value: 'name:desc', label: 'Nazwa (Z-A)' },
  { value: 'gmina:asc', label: 'Gmina (A-Z)' },
  { value: 'gmina:desc', label: 'Gmina (Z-A)' },
  { value: 'powiat:asc', label: 'Powiat (A-Z)' },
  { value: 'powiat:desc', label: 'Powiat (Z-A)' },
  { value: 'voivodeship:asc', label: 'Województwo (A-Z)' },
  { value: 'voivodeship:desc', label: 'Województwo (Z-A)' },
  { value: 'city:asc', label: 'Miasto (A-Z)' },
  { value: 'city:desc', label: 'Miasto (Z-A)' },
  { value: 'createdAt:desc', label: 'Data dodania (najnowsze)' },
  { value: 'createdAt:asc', label: 'Data dodania (najstarsze)' },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]['value'];

const PAGE_SIZE = 30;

/** The `gminas` prop, extended with the location fields the filter cascade needs. */
export interface GminaFilterOption extends GminaOption {
  powiat: string | null;
  voivodeship: string | null;
}

/** Shape GET /api/admin/organizations actually returns per row. */
interface ApiOrganization {
  id: string;
  name: string;
  street: string | null;
  houseNumber: string | null;
  apartmentNumber: string | null;
  city: string | null;
  postalCode: string | null;
  gminaId: string;
  gmina: { id: string; name: string };
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  _count: { users: number };
}

function mapOrganization(organization: ApiOrganization): OrganizationListItem {
  return {
    id: organization.id,
    name: organization.name,
    street: organization.street,
    houseNumber: organization.houseNumber,
    apartmentNumber: organization.apartmentNumber,
    city: organization.city,
    postalCode: organization.postalCode,
    gminaId: organization.gminaId,
    gminaName: organization.gmina.name,
    contactFirstName: organization.contactFirstName,
    contactLastName: organization.contactLastName,
    contactPhone: organization.contactPhone,
    contactEmail: organization.contactEmail,
    usersCount: organization._count.users,
  };
}

interface CachedOrganizationsPage {
  organizations: OrganizationListItem[];
  total: number;
  totalPages: number;
}

interface OrganizationsDirectoryProps {
  gminas: GminaFilterOption[];
  /** Forwarded to the create/edit forms' gmina pickers — see GminaSelect's doc comment. */
  canCreateGmina: boolean;
}

export function OrganizationsDirectory({ gminas, canCreateGmina }: OrganizationsDirectoryProps) {
  const [query, setQuery] = useState('');
  // Debounced, and only what's actually sent to the server — search runs as a
  // DB query (name/gmina/city/contact), not a client-side filter, so it
  // covers the whole directory instead of whatever page happened to load.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // 'ALL' means no filter. Powiat only ever makes sense once a voivodeship is
  // picked — same cascade as GminasDirectory's own filter row. Gmina narrows
  // further still, but (unlike powiat) stays pickable directly since a user
  // may already know the exact gmina they want without narrowing top-down.
  const [voivodeshipFilter, setVoivodeshipFilter] = useState<string>('ALL');
  const [powiatFilter, setPowiatFilter] = useState<string>('ALL');
  const [gminaFilter, setGminaFilter] = useState<string>('ALL');
  const [sort, setSort] = useState<SortValue>('name:asc');
  const [showCreate, setShowCreate] = useState(false);

  const [page, setPage] = useState(1);
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  // Set only around the initial mount/filter-change fetch (which legitimately
  // has nothing to show yet) — a background SSE/onChanged refetch uses this
  // instead, so the current cards stay on screen and just get swapped in
  // place once the new data lands, instead of the grid blanking out.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Voivodeships that actually exist among the system's gminas — derived
  // from the `gminas` prop already fetched for the create/edit form's picker,
  // so (unlike GminasDirectory's own locations endpoint) no extra round trip
  // is needed here.
  const voivodeships = useMemo(() => {
    const set = new Set<string>();
    for (const g of gminas) if (g.voivodeship) set.add(g.voivodeship);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [gminas]);

  const powiatsInVoivodeship = useMemo(() => {
    if (voivodeshipFilter === 'ALL') return [];
    const set = new Set<string>();
    for (const g of gminas) {
      if (g.voivodeship === voivodeshipFilter && g.powiat) set.add(g.powiat);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [gminas, voivodeshipFilter]);

  const gminasInFilter = useMemo(() => {
    // .filter() already returns a fresh array, so .sort() mutating it in
    // place doesn't touch the original `gminas` prop — no extra .slice() copy needed.
    return gminas
      .filter((g) => voivodeshipFilter === 'ALL' || g.voivodeship === voivodeshipFilter)
      .filter((g) => powiatFilter === 'ALL' || g.powiat === powiatFilter)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gminas, voivodeshipFilter, powiatFilter]);

  // If the voivodeship filter changes (or clears) after a powiat/gmina was
  // already picked, that selection may no longer be valid for the new
  // voivodeship — clear the stale selection rather than silently keep
  // filtering by it (mirrors GminasDirectory's own powiat-clearing effect).
  useEffect(() => {
    if (powiatFilter !== 'ALL' && !powiatsInVoivodeship.includes(powiatFilter)) {
      setPowiatFilter('ALL');
    }
  }, [powiatFilter, powiatsInVoivodeship]);

  useEffect(() => {
    if (gminaFilter !== 'ALL' && !gminasInFilter.some((g) => g.id === gminaFilter)) {
      setGminaFilter('ALL');
    }
  }, [gminaFilter, gminasInFilter]);

  // Guards against a slower earlier response landing after a faster later one
  // (e.g. rapidly switching filters) overwriting fresh results with stale ones.
  const requestIdRef = useRef(0);

  const fetchOrganizations = useCallback(
    async (targetPage: number, opts?: { allowCache?: boolean }) => {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
      if (gminaFilter !== 'ALL') params.set('gminaId', gminaFilter);
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
        const cached = getCachedList<CachedOrganizationsPage>('organizations', cacheKey);
        if (cached) {
          setOrganizations(cached.organizations);
          setTotal(cached.total);
          setTotalPages(cached.totalPages);
          setError(null);
          return;
        }
      }

      const requestId = ++requestIdRef.current;

      try {
        const res = await fetch(`/api/admin/organizations?${cacheKey}`);
        const data = await res.json().catch(() => ({}));

        if (requestId !== requestIdRef.current) return; // superseded by a newer request

        if (!res.ok) {
          setError(data.error ?? 'Nie udało się wczytać organizacji.');
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

        const mappedOrganizations = (data.organizations as ApiOrganization[]).map(mapOrganization);
        const total = data.total ?? 0;
        setOrganizations(mappedOrganizations);
        setTotal(total);
        setTotalPages(serverTotalPages);
        setError(null);
        setCachedList('organizations', cacheKey, {
          organizations: mappedOrganizations,
          total,
          totalPages: serverTotalPages,
        });
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error('[OrganizationsDirectory] failed to fetch:', err);
        setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
      }
    },
    [gminaFilter, voivodeshipFilter, powiatFilter, debouncedQuery, sort]
  );

  // Any filter (or sort) change invalidates the current page number — always
  // land back on page 1 rather than risk showing an out-of-range page for
  // the new, differently-ordered result set.
  useEffect(() => {
    setPage(1);
  }, [gminaFilter, voivodeshipFilter, powiatFilter, debouncedQuery, sort]);

  const didMountRef = useRef(false);
  useEffect(() => {
    const allowCache = !didMountRef.current;
    didMountRef.current = true;
    setLoading(true);
    fetchOrganizations(page, { allowCache }).finally(() => setLoading(false));
  }, [page, fetchOrganizations]);

  // Another admin's own create/edit/delete — see AdminEventsBridge (mounted
  // in admin/layout.tsx) for how this arrives.
  useAdminEvents('organizations', refetch);

  function refetch() {
    setRefreshing(true);
    fetchOrganizations(page).finally(() => setRefreshing(false));
  }

  const hasActiveFilters =
    query.trim() !== '' || voivodeshipFilter !== 'ALL' || powiatFilter !== 'ALL' || gminaFilter !== 'ALL';

  function clearFilters() {
    setQuery('');
    setDebouncedQuery('');
    setVoivodeshipFilter('ALL');
    setPowiatFilter('ALL');
    setGminaFilter('ALL');
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
            {voivodeships.map((v) => (
              <option key={v} value={v}>
                {v}
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
            value={gminaFilter}
            onChange={(e) => setGminaFilter(e.target.value)}
            className="lg:flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          >
            <option value="ALL">Wszystkie gminy</option>
            {gminasInFilter.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
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
              placeholder="Szukaj po nazwie, gminie, mieście, osobie kontaktowej…"
              className="w-full lg:h-[39px] rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-3 text-sm text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
            />
          </div>

          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 whitespace-nowrap">
            {rangeLabel}
            {refreshing && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" aria-hidden />}
          </span>

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
              className={`gap-1.5 flex-1 lg:h-[39px] lg:flex-none lg:shrink-0 ${hasActiveFilters ? 'h-auto' : 'h-[38px]'}`}
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-4 w-4" />
              Dodaj organizację
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
      ) : organizations.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <Building2 className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">Brak wyników</h3>
          <p className="text-xs text-slate-400 mt-1">Zmień kryteria wyszukiwania lub filtry.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {organizations.map((organization) => (
            <OrganizationCard
              key={organization.id}
              organization={organization}
              gminas={gminas}
              canCreateGmina={canCreateGmina}
              onChanged={refetch}
            />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={loading} />

      {showCreate && (
        <OrganizationFormModal
          mode="create"
          gminas={gminas}
          canCreateGmina={canCreateGmina}
          onClose={() => setShowCreate(false)}
          onSuccess={refetch}
        />
      )}
    </div>
  );
}
