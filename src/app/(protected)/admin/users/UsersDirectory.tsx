'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Clock, X, Users as UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/Pagination';
import { formatDate } from '@/lib/utils';
import { ROLE_LABELS } from '@/lib/users';
import type { OrganizationOption } from '@/components/organization/OrganizationSelect';
import { UserCard } from './UserCard';
import { UserFormModal } from './UserFormModal';
import type { UserGmina, UserListItem, UserRole } from './types';

const ROLE_OPTIONS = [
  { value: 'ALL', label: 'Wszystkie role' },
  { value: 'ADMIN', label: ROLE_LABELS.ADMIN },
  { value: 'COORDINATOR', label: ROLE_LABELS.COORDINATOR },
  { value: 'VOLUNTEER', label: ROLE_LABELS.VOLUNTEER },
] as const;

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'Wszystkie statusy' },
  { value: 'ACTIVE', label: 'Aktywni' },
  { value: 'INACTIVE', label: 'Nieaktywni' },
] as const;

// Encoded as a single "field:direction" value so one <select> can drive both
// — sorting is applied server-side (see GET /api/admin/users' sortBy/sortDir),
// not a client-side Array.sort over the current page, so it stays correct
// across pages instead of only reordering whatever 30 rows happened to load.
const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: 'Data dodania (najnowsi)' },
  { value: 'createdAt:asc', label: 'Data dodania (najstarsi)' },
  { value: 'lastActivatedAt:desc', label: 'Data aktywacji (najnowsi)' },
  { value: 'lastActivatedAt:asc', label: 'Data aktywacji (najstarsi)' },
  { value: 'lastDeactivatedAt:desc', label: 'Data dezaktywacji (najnowsi)' },
  { value: 'lastDeactivatedAt:asc', label: 'Data dezaktywacji (najstarsi)' },
  { value: 'name:asc', label: 'Imię i nazwisko (A-Z)' },
  { value: 'name:desc', label: 'Imię i nazwisko (Z-A)' },
] as const;

type RoleFilter = (typeof ROLE_OPTIONS)[number]['value'];
type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];
type SortValue = (typeof SORT_OPTIONS)[number]['value'];

const PAGE_SIZE = 30;

/** Shape GET /api/admin/users actually returns per row — dates are still raw ISO strings, formatted below before handing off to UserCard. */
interface ApiUser {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  organization: { id: string; name: string } | null;
  phone: string | null;
  isActive: boolean;
  lastActivatedAt: string | null;
  lastDeactivatedAt: string | null;
  deactivationReason: string | null;
  gmina: { id: string; name: string } | null;
  isSelf: boolean;
  canManage: boolean;
}

function mapUser(user: ApiUser): UserListItem {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organization: user.organization,
    phone: user.phone,
    isActive: user.isActive,
    lastActivatedAt: user.lastActivatedAt ? formatDate(user.lastActivatedAt) : null,
    lastDeactivatedAt: user.lastDeactivatedAt ? formatDate(user.lastDeactivatedAt) : null,
    deactivationReason: user.deactivationReason,
    gmina: user.gmina,
    isSelf: user.isSelf,
    canManage: user.canManage,
  };
}

interface UsersDirectoryProps {
  gminas: UserGmina[];
  organizations: OrganizationOption[];
  isAdmin: boolean;
}

export function UsersDirectory({ gminas, organizations, isAdmin }: UsersDirectoryProps) {
  const [query, setQuery] = useState('');
  // Debounced, and only what's actually sent to the server — search now runs
  // as a DB query (name/email/phone/organization/gmina/role-label/status),
  // not a client-side filter over an already-capped 200-row list, so it
  // covers the whole directory instead of whatever page happened to be loaded.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  // 'ALL' means no filter — only ADMIN ever sees these two (gminas/
  // organizations are only fetched for ADMIN in page.tsx; a coordinator is
  // already scoped server-side to their own single gmina, so a picker would
  // be pointless for them anyway).
  const [gminaFilter, setGminaFilter] = useState<string>('ALL');
  const [organizationFilter, setOrganizationFilter] = useState<string>('ALL');
  // Never activated (lastActivatedAt never set) = awaiting a first review by
  // an admin/coordinator. Defaulting to on surfaces that queue immediately;
  // the toggle drops back to the full directory.
  const [onlyPending, setOnlyPending] = useState(true);
  const [sort, setSort] = useState<SortValue>('createdAt:desc');
  const [showCreate, setShowCreate] = useState(false);

  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Organization is itself gmina-scoped, so once a gmina filter is picked,
  // only offer organizations that actually belong to it — an org from a
  // different gmina would never match anyway (see the API's AND semantics).
  const organizationsInGmina = useMemo(
    () => (gminaFilter === 'ALL' ? organizations : organizations.filter((o) => o.gminaId === gminaFilter)),
    [organizations, gminaFilter]
  );

  // If the gmina filter changes (or clears) after an organization filter was
  // already picked, that organization may no longer be a valid option —
  // clear the stale selection rather than silently keep filtering by it.
  useEffect(() => {
    if (organizationFilter !== 'ALL' && !organizationsInGmina.some((o) => o.id === organizationFilter)) {
      setOrganizationFilter('ALL');
    }
  }, [organizationFilter, organizationsInGmina]);

  // Guards against a slower earlier response landing after a faster later
  // one (e.g. rapidly switching filters) overwriting fresh results with
  // stale ones — only the response matching the CURRENT request is applied.
  const requestIdRef = useRef(0);

  const fetchUsers = useCallback(
    async (targetPage: number) => {
      const requestId = ++requestIdRef.current;

      try {
        const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
        if (roleFilter !== 'ALL') params.set('role', roleFilter);
        if (statusFilter !== 'ALL') params.set('status', statusFilter);
        if (gminaFilter !== 'ALL') params.set('gminaId', gminaFilter);
        if (organizationFilter !== 'ALL') params.set('organizationId', organizationFilter);
        if (onlyPending) params.set('onlyPending', 'true');
        if (debouncedQuery) params.set('q', debouncedQuery);
        const [sortBy, sortDir] = sort.split(':');
        params.set('sortBy', sortBy);
        params.set('sortDir', sortDir);

        const res = await fetch(`/api/admin/users?${params.toString()}`);
        const data = await res.json().catch(() => ({}));

        if (requestId !== requestIdRef.current) return; // superseded by a newer request

        if (!res.ok) {
          setError(data.error ?? 'Nie udało się wczytać użytkowników.');
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

        setUsers((data.users as ApiUser[]).map(mapUser));
        setTotal(data.total ?? 0);
        setTotalPages(serverTotalPages);
        setError(null);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error('[UsersDirectory] failed to fetch:', err);
        setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
      }
    },
    [roleFilter, statusFilter, gminaFilter, organizationFilter, onlyPending, debouncedQuery, sort]
  );

  // Any filter (or sort) change invalidates the current page number — always
  // land back on page 1 rather than risk showing an out-of-range page for
  // the new, differently-ordered result set.
  useEffect(() => {
    setPage(1);
  }, [roleFilter, statusFilter, gminaFilter, organizationFilter, onlyPending, debouncedQuery, sort]);

  useEffect(() => {
    setLoading(true);
    fetchUsers(page).finally(() => setLoading(false));
  }, [page, fetchUsers]);

  function refetch() {
    setLoading(true);
    fetchUsers(page).finally(() => setLoading(false));
  }

  // onlyPending is a view toggle (pending queue vs. full directory), not a
  // filter — it doesn't count toward "are filters active" and clearFilters()
  // below deliberately leaves it untouched.
  const hasActiveFilters =
    query.trim() !== '' ||
    roleFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    gminaFilter !== 'ALL' ||
    organizationFilter !== 'ALL';

  function clearFilters() {
    setQuery('');
    setDebouncedQuery('');
    setRoleFilter('ALL');
    setStatusFilter('ALL');
    setGminaFilter('ALL');
    setOrganizationFilter('ALL');
  }

  const rangeLabel =
    total === 0 ? '0 wyników' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} z ${total}`;

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-wrap">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className="lg:flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="lg:flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {isAdmin && (
            <select
              value={gminaFilter}
              onChange={(e) => setGminaFilter(e.target.value)}
              className="lg:flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
            >
              <option value="ALL">Wszystkie gminy</option>
              {gminas.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}

          {isAdmin && (
            <select
              value={organizationFilter}
              onChange={(e) => setOrganizationFilter(e.target.value)}
              className="lg:flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
            >
              <option value="ALL">Wszystkie organizacje</option>
              {organizationsInGmina.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}

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
          <div className="relative flex-1 min-w-[200px] lg:order-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj po imieniu, emailu, telefonie, roli, statusie, organizacji…"
              className="w-full lg:h-[39px] rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-3 text-sm text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
            />
          </div>

          <span className="text-xs font-semibold text-slate-400 whitespace-nowrap lg:order-3">{rangeLabel}</span>

          {/* On mobile this is a real row of its own (toggle, add, clear all
              on one line) — on lg+ it collapses to `contents` so its children
              rejoin the parent's flex layout directly, each pinned back to
              its original desktop position via lg:order-*, leaving the
              desktop appearance exactly as it was. */}
          {/* items-stretch (not items-center): if one button's label wraps to
              a second line on a narrow screen, it grows taller — the other
              two must match that height, not just its width. Only affects
              mobile; irrelevant once this becomes `contents` at lg+. */}
          <div className="flex items-stretch gap-2 lg:gap-3 w-full lg:contents">
            <button
              type="button"
              onClick={() => setOnlyPending((v) => !v)}
              aria-pressed={onlyPending}
              className={`flex-1 justify-center lg:flex-none lg:shrink-0 inline-flex items-center gap-1.5 px-2 lg:px-3 py-2 lg:h-[39px] rounded-xl text-xs font-bold border transition lg:order-2 ${
                onlyPending
                  ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              {/* Labels the ACTION a click performs, not the current state
                  (which the amber/gray styling already conveys) — clicking
                  while pending-only is active switches to the full
                  directory, so the label reads "Wszyscy użytkownicy", and
                  vice versa. */}
              {onlyPending ? 'Wszyscy użytkownicy' : 'Tylko nowi'}
            </button>

            {isAdmin && (
              <Button
                type="button"
                size="sm"
                className="gap-1.5 flex-1 h-auto lg:h-[39px] lg:flex-none lg:shrink-0 lg:order-5"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="h-4 w-4" />
                <span className="lg:hidden">Dodaj</span>
                <span className="hidden lg:inline">Dodaj użytkownika</span>
              </Button>
            )}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex-1 justify-center lg:flex-none lg:shrink-0 inline-flex items-center gap-1.5 px-2 lg:px-3 py-2 lg:h-[39px] rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition lg:order-4"
              >
                <X className="h-3.5 w-3.5" />
                <span className="lg:hidden">Wyczyść</span>
                <span className="hidden lg:inline">Wyczyść filtry</span>
              </button>
            )}
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
      ) : users.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <UsersIcon className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">
            {onlyPending ? 'Brak nowych użytkowników' : 'Brak wyników'}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {onlyPending
              ? 'Wszyscy użytkownicy zostali już aktywowani (albo zmień pozostałe filtry).'
              : 'Zmień kryteria wyszukiwania lub filtry.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              isAdmin={isAdmin}
              gminas={gminas}
              organizations={organizations}
              onChanged={refetch}
            />
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={loading} />

      {showCreate && (
        <UserFormModal
          mode="create"
          gminas={gminas}
          organizations={organizations}
          onClose={() => setShowCreate(false)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
