'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import AllocationStatusBadge from './AllocationStatusBadge';

export interface ContributionRow {
  id: string;
  quantity: number;
  unit: string;
  status: string;
  donorOrgName: string;
  createdByName: string | null;
  createdAt: Date | string;
}

interface AllocationContributorsListProps {
  allocations: ContributionRow[];
}

// "Pokaż kto przekazał (N)" (Крок 44) — under a single need, a collapsible
// history of every ResourceAllocation made toward it: who (donor org +
// author), how much, current status, when. The progress bar on
// AlertNeedsBlock (Крок 40) only shows the sum; this answers "who exactly".
export default function AllocationContributorsList({ allocations }: AllocationContributorsListProps) {
  const [expanded, setExpanded] = useState(false);

  if (allocations.length === 0) {
    return null;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-800 transition"
      >
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {expanded ? `Ukryj historię przydziałów (${allocations.length})` : `Pokaż historię przydziałów (${allocations.length})`}
      </button>

      {expanded && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white">
          {allocations.map((allocation) => (
            <li key={allocation.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {allocation.donorOrgName}
                  {allocation.createdByName && (
                    <span className="font-normal text-slate-500"> ({allocation.createdByName})</span>
                  )}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <AllocationStatusBadge status={allocation.status} />
                  <span className="text-[11px] text-slate-400">{formatDate(allocation.createdAt)}</span>
                </div>
              </div>
              <span className="shrink-0 text-xs font-bold text-emerald-600">
                +{allocation.quantity} {allocation.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
