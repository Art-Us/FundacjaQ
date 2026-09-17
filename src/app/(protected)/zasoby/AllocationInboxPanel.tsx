'use client';

import { AlertTriangle, Undo2 } from 'lucide-react';
import { ALERT_STATUS_LABELS } from '@/lib/alertLabels';
import { getAllocationStatusInfo } from '@/lib/resourceLabels';
import type { AllocationInboxRow } from '@/lib/allocationInbox';

interface AllocationInboxPanelProps {
  recipient: AllocationInboxRow[];
  donor: AllocationInboxRow[];
  // Крок 47 (Фаза 7) wires this to actually open ReturnResourcesModal — until
  // then the button is visually present but inert, the same "button now,
  // behavior later" staging AlertNeedsBlock uses (Крок 40 → 46).
  onReturnClick?: (allocation: AllocationInboxRow) => void;
}

function joinReturnMessages(allocation: AllocationInboxRow): string | null {
  const messages = allocation.returnEvents.map((event) => event.message).filter((message): message is string => !!message);
  return messages.length > 0 ? messages.join(' · ') : null;
}

// R7 — "Wymaga działania": the RECIPIENT sees a "Zwróć zasoby" button per row
// (only it may act — decision #3); the DONOR sees the same underlying data
// purely as information, no action. Both sections come straight from
// fetchAllocationInbox (lib/allocationInbox.ts, Крок 27/31).
export default function AllocationInboxPanel({ recipient, donor, onReturnClick }: AllocationInboxPanelProps) {
  if (recipient.length === 0 && donor.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {recipient.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            <h3 className="text-sm font-bold">Wymaga działania</h3>
          </div>
          <ul className="divide-y divide-amber-100">
            {recipient.map((allocation) => {
              // R4 — a return message must surface here, not only inside the
              // allocation's own history.
              const returnMessage = joinReturnMessages(allocation);
              return (
                <li key={allocation.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{allocation.itemName}</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {allocation.alert.title} · {ALERT_STATUS_LABELS[allocation.alert.status] ?? allocation.alert.status} ·{' '}
                      {allocation.quantity} {allocation.unit}
                    </p>
                    {returnMessage && <p className="text-xs text-slate-500 mt-1 italic">„{returnMessage}”</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => onReturnClick?.(allocation)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Zwróć zasoby
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {donor.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Twoje zasoby w trakcie</h3>
          <ul className="divide-y divide-slate-100">
            {donor.map((allocation) => {
              const statusInfo = getAllocationStatusInfo(allocation.status);
              const alertPhrase =
                allocation.alert.status === 'CANCELLED'
                  ? 'Alert odwołany — oczekuje na zwrot.'
                  : 'Alert rozwiązany — oczekuje na zwrot.';
              return (
                <li key={allocation.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{allocation.itemName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {allocation.alert.title} · {alertPhrase}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-bold uppercase px-2 py-1 rounded-full border ${statusInfo.badgeClass}`}
                  >
                    {statusInfo.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
