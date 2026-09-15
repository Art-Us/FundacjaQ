'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldOff, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SecurityEventRow, type SecurityEventLike } from './SecurityEventRow';

const PAGE_SIZE = 50;
// Debounces the email search box so typing doesn't fire one request per
// keystroke — same UX as a moment's pause before searching, without adding a
// library.
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Read-only, paginated list backing the "Logowania" tab — no revert, unlike
 * the admin action audit trail.
 */
export function SecurityEventDirectory({
  endpoint,
  emptyLabel,
}: {
  endpoint: string;
  emptyLabel: string;
}) {
  const [emailInput, setEmailInput] = useState('');
  const [email, setEmail] = useState('');
  const [success, setSuccess] = useState('');

  const [items, setItems] = useState<SecurityEventLike[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce: only commit the typed value to `email` (which triggers a
  // fetch) once the user pauses for a moment.
  useEffect(() => {
    const timer = setTimeout(() => setEmail(emailInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [emailInput]);

  // Guards against two hazards inherent to "fire a request, then set state
  // from its response" without cancellation: (1) a slower earlier response
  // landing after a faster later one (e.g. rapid typing before the debounce
  // above settles, or switching the success filter quickly) would otherwise
  // overwrite fresh results with stale ones; (2) a "Load more" click
  // in-flight when a filter changes would otherwise append old-filter rows
  // onto the new-filter list. Only the response matching the CURRENT request
  // (the latest one issued) is ever applied to state.
  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    async (afterCursor: string | null, replace: boolean) => {
      const requestId = ++requestIdRef.current;

      try {
        const params = new URLSearchParams({ take: String(PAGE_SIZE) });
        if (email) params.set('email', email);
        if (success) params.set('success', success);
        if (afterCursor) params.set('cursor', afterCursor);

        const res = await fetch(`${endpoint}?${params.toString()}`);
        const data = await res.json().catch(() => ({}));

        if (requestId !== requestIdRef.current) return; // superseded by a newer request

        if (!res.ok) {
          setError(data.error ?? 'Nie udało się wczytać dziennika.');
          return;
        }

        setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
        setCursor(data.nextCursor ?? null);
        setError(null);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error('[SecurityEventDirectory] failed to fetch:', err);
        setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
      }
    },
    [endpoint, email, success]
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

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="Szukaj po adresie email…"
            className="w-full rounded-xl bg-slate-50 border border-slate-200 py-2.5 pl-10 pr-3 text-sm text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
          />
        </div>

        <select
          value={success}
          onChange={(e) => setSuccess(e.target.value)}
          className="rounded-xl bg-slate-50 border border-slate-200 py-2.5 px-3 text-sm text-slate-700 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 transition"
        >
          <option value="">Wszystkie wyniki</option>
          <option value="true">Tylko sukces</option>
          <option value="false">Tylko niepowodzenie</option>
        </select>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-600">{error}</div>
      )}

      {loading ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <p className="text-sm text-slate-400">Wczytywanie…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-3xl bg-white p-12 text-center border border-slate-200/80 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-3">
            <ShieldOff className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">Brak wpisów</h3>
          <p className="text-xs text-slate-400 mt-1">{emptyLabel}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <SecurityEventRow key={item.id} item={item} />
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
