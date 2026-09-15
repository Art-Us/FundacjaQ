'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { History, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuditLogRow } from './AuditLogRow';
import { ACTION_KIND_LABELS, ENTITY_TYPE_LABELS, type AuditLogItem } from './types';

const PAGE_SIZE = 50;

export function AuditLogDirectory() {
  const [entityType, setEntityType] = useState('');
  const [actionKind, setActionKind] = useState('');
  const [query, setQuery] = useState('');
  // Debounced, and only what's actually sent to the server — searching only
  // the page already loaded in the browser used to give a false "no
  // results" for anything not yet paged in, which is the wrong failure mode
  // for a security audit trail.
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against two hazards inherent to "fire a request, then set state
  // from its response" without cancellation: (1) a slower earlier response
  // landing after a faster later one (e.g. rapidly switching entityType/
  // actionKind) would otherwise overwrite fresh results with stale ones; (2)
  // a "Load more" click in-flight when a filter changes would otherwise
  // append old-filter rows onto the new-filter list. Only the response
  // matching the CURRENT request (the latest one issued) is ever applied.
  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    async (afterCursor: string | null, replace: boolean) => {
      const requestId = ++requestIdRef.current;

      try {
        const params = new URLSearchParams({ take: String(PAGE_SIZE) });
        if (entityType) params.set('entityType', entityType);
        if (actionKind) params.set('actionKind', actionKind);
        if (debouncedQuery) params.set('q', debouncedQuery);
        if (afterCursor) params.set('cursor', afterCursor);

        const res = await fetch(`/api/admin/logs?${params.toString()}`);
        const data = await res.json().catch(() => ({}));

        if (requestId !== requestIdRef.current) return; // superseded by a newer request

        if (!res.ok) {
          setError(data.error ?? 'Nie udało się wczytać dziennika.');
          return;
        }

        setLogs((prev) => (replace ? data.logs : [...prev, ...data.logs]));
        setCursor(data.nextCursor ?? null);
        setError(null);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error('[AuditLogDirectory] failed to fetch:', err);
        setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
      }
    },
    [entityType, actionKind, debouncedQuery]
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

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj po osobie lub ID encji…"
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
      ) : logs.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <History className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">Brak wpisów</h3>
          <p className="text-xs text-slate-400 mt-1">Zmień kryteria filtrowania albo wróć później.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <AuditLogRow key={log.id} log={log} onReverted={handleReverted} />
          ))}
        </div>
      )}

      {!loading && cursor && (
        <div className="flex justify-center pt-2">
          <Button type="button" variant="secondary" size="sm" disabled={loadingMore} onClick={handleLoadMore}>
            {loadingMore ? 'Wczytywanie…' : 'Wczytaj więcej'}
          </Button>
        </div>
      )}
    </div>
  );
}
