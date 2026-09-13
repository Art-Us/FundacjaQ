'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ACTION_LABELS, ENTITY_TYPE_LABELS, entityLabel, type AuditLogItem } from './types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Fields present in `before` or `after` whose value actually differs — the rest is noise. */
function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  return keys.filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'tak' : 'nie';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value);
  return String(value);
}

export function AuditLogRow({ log, onReverted }: { log: AuditLogItem; onReverted: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevert() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/logs/${log.id}/revert`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'Nie udało się cofnąć zmiany.');
        return;
      }

      setConfirming(false);
      onReverted();
    } catch (err) {
      console.error('[AuditLogRow] failed to revert:', err);
      setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  }

  const fields = changedFields(log.before, log.after);

  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 shadow-2xs overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex flex-wrap items-center gap-x-4 gap-y-1.5 p-4 text-left hover:bg-slate-50/80 transition"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
        )}

        <span className="text-xs font-mono text-slate-400 shrink-0 w-36">{formatDate(log.createdAt)}</span>

        <span className="text-xs font-bold text-slate-700 shrink-0">
          {log.actorName ?? log.actorEmail}
          <span className="font-normal text-slate-400"> ({log.actorEmail})</span>
        </span>

        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 shrink-0">
          {log.isRevert && <Undo2 className="h-3 w-3" />}
          {ACTION_LABELS[log.action] ?? log.action}
        </span>

        <span className="text-xs text-slate-500 truncate">
          {ENTITY_TYPE_LABELS[log.entityType] ?? log.entityType}: <span className="font-semibold">{entityLabel(log)}</span>
        </span>

        {log.revertedAt && (
          <span className="text-[11px] font-semibold text-amber-600 ml-auto shrink-0">Cofnięte</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/60 space-y-3">
          {fields.length === 0 ? (
            <p className="text-xs text-slate-400">Brak zarejestrowanych zmian pól.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-left">
                    <th className="font-semibold pr-4 py-1">Pole</th>
                    <th className="font-semibold pr-4 py-1">Przed</th>
                    <th className="font-semibold py-1">Po</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field} className="border-t border-slate-200/70">
                      <td className="pr-4 py-1.5 font-mono text-slate-500">{field}</td>
                      <td className="pr-4 py-1.5 text-rose-600">{formatValue(log.before?.[field])}</td>
                      <td className="py-1.5 text-emerald-600">{formatValue(log.after?.[field])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {log.ipAddress && <span>IP: {log.ipAddress}</span>}
          </div>

          {log.canRevert && (
            <div className="pt-1">
              {confirming ? (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="danger" size="sm" disabled={loading} onClick={handleRevert}>
                    {loading ? 'Cofanie…' : 'Tak, cofnij zmianę'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => setConfirming(false)}>
                    Anuluj
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setConfirming(true)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Cofnij zmianę
                </Button>
              )}
              {error && <p className="text-xs text-rose-500 mt-1.5">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
