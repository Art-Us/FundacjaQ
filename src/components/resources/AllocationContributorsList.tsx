'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Truck, Undo2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { isAllocationDonor, isAllocationRecipient } from '@/lib/resourceAuthz';
import AllocationStatusBadge from './AllocationStatusBadge';
import ReturnResourcesModal from './ReturnResourcesModal';
import { apiSend } from '@/lib/apiClient';

export interface ContributionRow {
  id: string;
  itemName: string;
  quantity: number;
  quantityReturned: number;
  quantityNotReturnable: number;
  unit: string;
  status: string;
  donorOrgId: string;
  donorOrgName: string;
  createdByName: string | null;
  createdAt: Date | string;
}

interface AllocationContributorsListProps {
  allocations: ContributionRow[];
  currentUserRole: string;
  currentUserOrganizationId: string | null;
  // The alert's own organization — the recipient side of every allocation
  // under it (isAllocationRecipient just wraps isAlertOwnerOrg against this).
  alertOrganizationId: string | null;
  // For ReturnResourcesModal's header line — the same "item · alert" context
  // AllocationInboxPanel already shows for this same modal.
  alertTitle: string;
}

// "Pokaż kto przekazał (N)" (Крок 44) — under a single need, a collapsible
// history of every ResourceAllocation made toward it: who (donor org +
// author), how much, current status, when. The progress bar on
// AlertNeedsBlock (Крок 40) only shows the sum; this answers "who exactly".
//
// Also the only place either side can actually advance a delivery
// (DELIVERY_AGREED → DELIVERED, decision #3: donor OR recipient, whoever
// clicks first) or the recipient can agree to a return (DELIVERED →
// RETURN_AGREED) — PATCH /api/allocations/[id] (Крок 24) has authorized both
// since the API was built, but until now nothing in the UI ever called it,
// which also meant an allocation could never reach RETURN_AGREED, and
// POST .../return-events (Крок 25/47) requires exactly that status.
//
// "Zwróć zasoby" (recording the actual return quantities, RETURN_AGREED/
// PARTIALLY_RETURNED → RETURNED) lives here too, not only in
// AllocationInboxPanel on /zasoby — that panel is scoped to the caller's own
// organizationId and to already-closed alerts (fetchAllocationInbox,
// lib/allocationInbox.ts), so it never surfaces anything for an ADMIN with no
// organization of their own (the alert's own owner org, if it's ADMIN-created
// and orgless) or for an allocation on a still-ACTIVE alert. This is the one
// place that gate doesn't apply — same isAdmin-aware check as the two
// transitions above.
export default function AllocationContributorsList({
  allocations,
  currentUserRole,
  currentUserOrganizationId,
  alertOrganizationId,
  alertTitle,
}: AllocationContributorsListProps) {
  const router = useRouter();
  const isAdmin = currentUserRole === 'ADMIN';
  const canAct = isAdmin || currentUserRole === 'COORDINATOR';

  function canReturn(a: ContributionRow): boolean {
    return (
      (a.status === 'RETURN_AGREED' || a.status === 'PARTIALLY_RETURNED') &&
      (isAdmin || isAllocationRecipient({ alert: { organizationId: alertOrganizationId } }, { organizationId: currentUserOrganizationId }))
    );
  }

  const hasActionable = allocations.some((a) => {
    if (!canAct) return false;
    if (a.status === 'DELIVERY_AGREED') {
      return isAdmin || isAllocationDonor(a, { organizationId: currentUserOrganizationId }) || isAllocationRecipient({ alert: { organizationId: alertOrganizationId } }, { organizationId: currentUserOrganizationId });
    }
    if (a.status === 'DELIVERED') {
      return isAdmin || isAllocationRecipient({ alert: { organizationId: alertOrganizationId } }, { organizationId: currentUserOrganizationId });
    }
    return canAct && canReturn(a);
  });

  const [expanded, setExpanded] = useState(hasActionable);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [returning, setReturning] = useState<ContributionRow | null>(null);

  if (allocations.length === 0) {
    return null;
  }

  async function updateStatus(allocationId: string, status: 'DELIVERED' | 'RETURN_AGREED') {
    setUpdatingId(allocationId);
    setError(null);

    const result = await apiSend(`/api/allocations/${allocationId}`, 'PATCH', { status });
    setUpdatingId(null);

    if (!result.ok) {
      setError({ id: allocationId, message: result.error });
      return;
    }

    router.refresh();
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
          {allocations.map((allocation) => {
            const canConfirmDelivery =
              canAct &&
              allocation.status === 'DELIVERY_AGREED' &&
              (isAdmin ||
                isAllocationDonor(allocation, { organizationId: currentUserOrganizationId }) ||
                isAllocationRecipient({ alert: { organizationId: alertOrganizationId } }, { organizationId: currentUserOrganizationId }));
            const canAgreeReturn =
              canAct &&
              allocation.status === 'DELIVERED' &&
              (isAdmin || isAllocationRecipient({ alert: { organizationId: alertOrganizationId } }, { organizationId: currentUserOrganizationId }));
            const canRecordReturn = canAct && canReturn(allocation);
            const isUpdating = updatingId === allocation.id;

            return (
              <li key={allocation.id} className="px-3 py-2 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
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
                </div>

                {(canConfirmDelivery || canAgreeReturn || canRecordReturn) && (
                  <div className="flex items-center gap-2 pt-0.5">
                    {canConfirmDelivery && (
                      <button
                        type="button"
                        onClick={() => updateStatus(allocation.id, 'DELIVERED')}
                        disabled={isUpdating}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold border border-indigo-200 transition disabled:opacity-50"
                      >
                        <Truck className="h-3 w-3" />
                        {isUpdating ? 'Zapisywanie…' : 'Potwierdź dostawę'}
                      </button>
                    )}
                    {canAgreeReturn && (
                      <button
                        type="button"
                        onClick={() => updateStatus(allocation.id, 'RETURN_AGREED')}
                        disabled={isUpdating}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-bold border border-amber-200 transition disabled:opacity-50"
                      >
                        <Undo2 className="h-3 w-3" />
                        {isUpdating ? 'Zapisywanie…' : 'Uzgodnij zwrot'}
                      </button>
                    )}
                    {canRecordReturn && (
                      <button
                        type="button"
                        onClick={() => setReturning(allocation)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition"
                      >
                        <Undo2 className="h-3 w-3" />
                        Zwróć zasoby
                      </button>
                    )}
                  </div>
                )}

                {error?.id === allocation.id && <p className="text-[11px] text-rose-600">{error.message}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {returning && (
        <ReturnResourcesModal
          allocationId={returning.id}
          itemName={returning.itemName}
          unit={returning.unit}
          quantity={returning.quantity}
          quantityReturned={returning.quantityReturned}
          quantityNotReturnable={returning.quantityNotReturnable}
          status={returning.status}
          alertTitle={alertTitle}
          onClose={() => setReturning(null)}
          onReturned={() => setReturning(null)}
        />
      )}
    </div>
  );
}
