'use client';

import { useMemo, useState } from 'react';
import { Search, Plus, Clock, Users as UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserCard } from './UserCard';
import { UserFormModal } from './UserFormModal';
import type { UserGmina, UserListItem } from './types';

const ROLE_OPTIONS = [
  { value: 'ALL', label: 'Wszystkie role' },
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'COORDINATOR', label: 'Koordynator' },
  { value: 'VOLUNTEER', label: 'Wolontariusz' },
] as const;

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'Wszystkie statusy' },
  { value: 'ACTIVE', label: 'Aktywni' },
  { value: 'INACTIVE', label: 'Nieaktywni' },
] as const;

type RoleFilter = (typeof ROLE_OPTIONS)[number]['value'];
type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];

interface UsersDirectoryProps {
  users: UserListItem[];
  gminas: UserGmina[];
  isAdmin: boolean;
}

export function UsersDirectory({ users, gminas, isAdmin }: UsersDirectoryProps) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  // Never activated (lastActivatedAt never set) = awaiting a first review by
  // an admin/coordinator. Defaulting to on surfaces that queue immediately;
  // the count badge and toggle let you drop back to the full directory.
  const [onlyPending, setOnlyPending] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const pendingCount = useMemo(() => users.filter((u) => !u.lastActivatedAt).length, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      if (onlyPending && user.lastActivatedAt) return false;
      if (roleFilter !== 'ALL' && user.role !== roleFilter) return false;
      if (statusFilter === 'ACTIVE' && !user.isActive) return false;
      if (statusFilter === 'INACTIVE' && user.isActive) return false;
      if (!q) return true;
      const haystack = [user.name, user.email, user.organization, user.gmina?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [users, query, roleFilter, statusFilter, onlyPending]);

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj po imieniu, emailu, organizacji…"
            className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-3 text-sm text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className="rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
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
          className="rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 text-xs font-semibold text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setOnlyPending((v) => !v)}
          aria-pressed={onlyPending}
          className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition ${
            onlyPending
              ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          {onlyPending ? `Tylko nowi (${pendingCount})` : 'Wszyscy użytkownicy'}
        </button>

        <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">
          {filtered.length} z {users.length}
        </span>

        {isAdmin && (
          <Button type="button" size="sm" className="gap-1.5 shrink-0" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            Dodaj użytkownika
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <UsersIcon className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">
            {onlyPending && pendingCount === 0 ? 'Brak nowych użytkowników' : 'Brak wyników'}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {onlyPending && pendingCount === 0
              ? 'Wszyscy użytkownicy zostali już aktywowani.'
              : 'Zmień kryteria wyszukiwania lub filtry.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((user) => (
            <UserCard key={user.id} user={user} isAdmin={isAdmin} gminas={gminas} />
          ))}
        </div>
      )}

      {showCreate && <UserFormModal mode="create" gminas={gminas} onClose={() => setShowCreate(false)} />}
    </div>
  );
}
