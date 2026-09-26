'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Truck, Undo2, Pencil, Check, X, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { isAllocationDonor, isAllocationRecipient } from '@/lib/resourceAuthz';
import AllocationStatusBadge from './AllocationStatusBadge';
import { apiSend } from '@/lib/apiClient';

export interface ContributionRow {
  id: string;
  quantity: number;
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
export default function AllocationContributorsList({
  allocations,
  currentUserRole,
  currentUserOrganizationId,
  alertOrganizationId,
}: AllocationContributorsListProps) {
  const router = useRouter();
  const isAdmin = currentUserRole === 'ADMIN';
  const canAct = isAdmin || currentUserRole === 'COORDINATOR';

  // Only the donor (or an admin) may fix a typo'd quantity, and only before
  // either side has confirmed delivery — past DELIVERY_AGREED, the recipient
  // may already be relying on the number that was agreed.
  const canEditQuantity = (a: ContributionRow) =>
    canAct && a.status === 'DELIVERY_AGREED' && (isAdmin || isAllocationDonor(a, { organizationId: currentUserOrganizationId }));

  const hasActionable = allocations.some((a) => {
    if (!canAct) return false;
    if (canEditQuantity(a)) return true;
    if (a.status === 'DELIVERY_AGREED') {
      return (
        isAdmin ||
        isAllocationDonor(a, { organizationId: currentUserOrganizationId }) ||
        isAllocationRecipient({ alert: { organizationId: alertOrganizationId } }, { organizationId: currentUserOrganizationId })
      );
    }
    if (a.status === 'DELIVERED') {
      return isAdmin || isAllocationRecipient({ alert: { organizationId: alertOrganizationId } }, { organizationId: currentUserOrganizationId });
    }
    return false;
  });

  const [expanded, setExpanded] = useState(hasActionable);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  // Two-step confirm before actually cancelling — mirrors DeleteOrganizationButton's
  // pattern elsewhere in the admin UI, since withdrawing a donation can't be undone
  // except by creating a brand-new allocation.
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  if (allocations.length === 0) {
    return null;
  }

  async function updateStatus(allocationId: string, status: 'DELIVERED' | 'RETURN_AGREED' | 'CANCELLED') {
    setUpdatingId(allocationId);
    setError(null);

    const result = await apiSend(`/api/allocations/${allocationId}`, 'PATCH', { status });
    setUpdatingId(null);

    if (!result.ok) {
      setError({ id: allocationId, message: result.error });
      return;
    }

    setCancelingId(null);
    router.refresh();
  }

  function startEditing(allocation: ContributionRow) {
    setEditingId(allocation.id);
    setEditQuantity(String(allocation.quantity));
    setError(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditQuantity('');
  }

  async function saveQuantity(allocationId: string) {
    const quantity = Number(editQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError({ id: allocationId, message: 'Ilość musi być liczbą całkowitą większą od zera.' });
      return;
    }

    setUpdatingId(allocationId);
    setError(null);

    const result = await apiSend(`/api/allocations/${allocationId}`, 'PATCH', { quantity });
    setUpdatingId(null);

    if (!result.ok) {
      setError({ id: allocationId, message: result.error });
      return;
    }

    setEditingId(null);
    setEditQuantity('');
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
            const isUpdating = updatingId === allocation.id;
            const isEditing = editingId === allocation.id;
            const canEdit = canEditQuantity(allocation);

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

                  {isEditing ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        autoFocus
                        value={editQuantity}
                        onChange={(e) => setEditQuantity(e.target.value)}
                        className="w-16 rounded-lg border border-indigo-300 bg-white py-1 px-1.5 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">{allocation.unit}</span>
                      <button
                        type="button"
                        onClick={() => saveQuantity(allocation.id)}
                        disabled={isUpdating}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold border border-emerald-200 transition disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" />
                        {isUpdating ? 'Zapisywanie…' : 'Zapisz'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isUpdating}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold transition disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                        Anuluj
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-bold text-emerald-600">
                        +{allocation.quantity} {allocation.unit}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => startEditing(allocation)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 text-[11px] font-semibold transition"
                        >
                          <Pencil className="h-3 w-3" />
                          Edytuj ilość
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {(canConfirmDelivery || canAgreeReturn || canEdit) && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
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
                    {canEdit && cancelingId === allocation.id ? (
                      <span className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-rose-700 font-semibold">Na pewno anulować ten przydział?</span>
                        <button
                          type="button"
                          onClick={() => updateStatus(allocation.id, 'CANCELLED')}
                          disabled={isUpdating}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold transition disabled:opacity-50"
                        >
                          {isUpdating ? 'Anulowanie…' : 'Tak, anuluj'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelingId(null)}
                          disabled={isUpdating}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold transition disabled:opacity-50"
                        >
                          Nie
                        </button>
                      </span>
                    ) : (
                      canEdit && (
                        <button
                          type="button"
                          onClick={() => setCancelingId(allocation.id)}
                          disabled={isUpdating}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold border border-rose-200 transition disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Anuluj przydział
                        </button>
                      )
                    )}
                  </div>
                )}

                {error?.id === allocation.id && <p className="text-[11px] text-rose-600">{error.message}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
