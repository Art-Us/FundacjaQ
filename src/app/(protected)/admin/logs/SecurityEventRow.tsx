'use client';

import { CheckCircle2, XCircle } from 'lucide-react';

// Structurally matches LoginAttemptItem (types.ts) — kept minimal on purpose.
export interface SecurityEventLike {
  id: string;
  email: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
}

export function SecurityEventRow({ item }: { item: SecurityEventLike }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 shadow-2xs p-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="text-xs font-mono text-slate-400 shrink-0 w-36">{formatDate(item.createdAt)}</span>

      <span className="text-xs font-bold text-slate-700 shrink-0">{item.email}</span>

      <span
        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
          item.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }`}
      >
        {item.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
        {item.success ? 'Sukces' : 'Niepowodzenie'}
      </span>

      {item.ipAddress && <span className="text-xs text-slate-400 shrink-0">IP: {item.ipAddress}</span>}

      {item.userAgent && (
        <span className="text-xs text-slate-400 truncate max-w-xs" title={item.userAgent}>
          {item.userAgent}
        </span>
      )}
    </div>
  );
}
