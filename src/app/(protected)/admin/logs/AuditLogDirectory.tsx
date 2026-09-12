'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuditLogRow } from './AuditLogRow';
import { ACTION_LABELS, ACTION_KIND_LABELS, ENTITY_TYPE_LABELS, type AuditLogItem } from './types';

const PAGE_SIZE = 50;

export function AuditLogDirectory() {
  const [entityType, setEntityType] = useState('');
  const [actionKind, setActionKind] = useState('');
  const [query, setQuery] = useState('');

  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (afterCursor: string | null, replace: boolean) => {
      const params = new URLSearchParams({ take: String(PAGE_SIZE) });
      if (entityType) params.set('entityType', entityType);
      if (actionKind) params.set('actionKind', actionKind);
      if (afterCursor) params.set('cursor', afterCursor);

      const res = await fetch(`/api/admin/logs?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Nie udało się wczytać dziennika.');
        return;
      }

      setLogs((prev) => (replace ? data.logs : [...prev, ...data.logs]));
      setCursor(data.nextCursor ?? null);
      setError(null);
    },
    [entityType, actionKind]
  );

  useEffect(() => {
    setLoading(true);
    fetchPage(null, true).finally(() => setLoading(false));
  }, [fetchPage]);

  async function handleLoadMore() {
    setLoadingMore(true);
    await fetchPage(cursor, false);
    setLoadingMore(false);
  }

  function handleReverted() {
    // Simplest correct refresh after a revert: the acted-on row's canRevert
    // flips and a brand-new "revert" row appears at the top — reloading the
    // first page picks up both without trying to patch state by hand.
    setLoading(true);
    fetchPage(null, true).finally(() => setLoading(false));
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? logs.filter((log) => {
        const haystack = [log.actorEmail, log.actorName, log.entityId, ACTION_LABELS[log.action] ?? log.action]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
    : logs;

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj po osobie, encji, działaniu…"
            className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-3 text-sm text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          />
        </div>

        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3 text-sm text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
        >
          <option value="">Wszystkie encje</option>
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={actionKind}
          onChange={(e) => setActionKind(e.target.value)}
          className="rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3 text-sm text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
        >
          <option value="">Wszystkie działania</option>
          {Object.entries(ACTION_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-600">{error}</div>
      )}

      {loading ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <p className="text-sm text-slate-400">Wczytywanie…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <History className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">Brak wpisów</h3>
          <p className="text-xs text-slate-400 mt-1">Zmień kryteria filtrowania albo wróć później.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => (
            <AuditLogRow key={log.id} log={log} onReverted={handleReverted} />
          ))}
        </div>
      )}

      {!loading && !query && cursor && (
        <div className="flex justify-center pt-2">
          <Button type="button" variant="secondary" size="sm" disabled={loadingMore} onClick={handleLoadMore}>
            {loadingMore ? 'Wczytywanie…' : 'Wczytaj więcej'}
          </Button>
        </div>
      )}
    </div>
  );
}
