'use client';

import { useState } from 'react';
import { Package, Pencil, Send, PackageCheck } from 'lucide-react';
import { getNeedUrgencyInfo } from '@/lib/resourceLabels';
import AllocateResourcesModal from '@/components/resources/AllocateResourcesModal';
import AllocationContributorsList, { type ContributionRow } from '@/components/resources/AllocationContributorsList';
import NeedFormModal, { type ExistingNeed } from './NeedFormModal';

// Minimal, structural shape — deliberately not a Prisma payload type, so this
// component stays reusable wherever a list of needs is available (map card,
// archive card, later the alert detail page) without depending on exactly
// which relations the caller's query happened to include.
export interface AlertNeedRow {
  id: string;
  categoryId: string;
  title: string;
  quantityNeeded: number;
  quantityFulfilled: number;
  unit: string;
  urgency: string;
  status: string;
  allocations: ContributionRow[];
}

const CLOSED_NEED_STATUSES = new Set(['FULFILLED', 'CLOSED', 'CANCELLED']);

interface AlertNeedsBlockProps {
  alertId: string;
  alertTitle: string;
  alertLocationLabel: string;
  alertDescription: string;
  // Gates "Przydziel zasoby" alongside each need's own status: a RESOLVED/
  // CANCELLED alert no longer accepts new allocations (POST
  // /api/alerts/[id]/allocations rejects it with 409 regardless), so the
  // button shouldn't be offered at all once the alert itself is closed.
  alertStatus: string;
  needs: AlertNeedRow[];
  // Owner org or ADMIN — gates "Edytuj zapotrzebowanie" (Крок 42/21-22): only
  // the alert's own organization declares/edits what it needs.
  canManageNeeds: boolean;
  // Has an organization of its own at all — POST /api/alerts/[id]/allocations
  // (Крок 23) requires one, so there's no point showing "Przydziel zasoby" to
  // an ADMIN with no organization to donate from.
  canAllocate: boolean;
  currentUserRole: string;
  currentUserOrganizationId: string | null;
  // The alert's own organization — the recipient side of every allocation
  // under it, needed by AllocationContributorsList to gate "Potwierdź
  // dostawę"/"Uzgodnij zwrot" (Крок 24) per row.
  alertOrganizationId: string | null;
  // Which of the alert's needs fall in a category the caller's own
  // organization already has something available in (lib/resourceMatching.ts,
  // Крок 43) — surfaced per-row as "W Twoim magazynie".
  ownedCategoryIds: Set<string>;
}

// R11 — "Zapotrzebowanie na zasoby" block on an alert's card: progress bars
// (Крок 40) plus, from Крок 46 onward, the actions that attach to the same
// list — "Przydziel zasoby" (Крок 41), "Edytuj zapotrzebowanie" (Крок 42) and
// the per-need contributors history (Крок 44).
export default function AlertNeedsBlock({
  alertId,
  alertTitle,
  alertLocationLabel,
  alertDescription,
  alertStatus,
  needs,
  canManageNeeds,
  canAllocate,
  currentUserRole,
  currentUserOrganizationId,
  alertOrganizationId,
  ownedCategoryIds,
}: AlertNeedsBlockProps) {
  const [editingNeeds, setEditingNeeds] = useState(false);
  const [allocatingNeed, setAllocatingNeed] = useState<AlertNeedRow | null>(null);

  if (needs.length === 0 && !canManageNeeds) {
    return null;
  }

  const alertClosed = alertStatus === 'RESOLVED' || alertStatus === 'CANCELLED';

  const existingNeeds: ExistingNeed[] = needs.map((need) => ({
    id: need.id,
    categoryId: need.categoryId,
    title: need.title,
    quantityNeeded: need.quantityNeeded,
    quantityFulfilled: need.quantityFulfilled,
    unit: need.unit,
    urgency: need.urgency,
  }));

  return (
    <div className="space-y-2.5 pt-2 border-t border-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-slate-700">
          <Package className="h-4 w-4" />
          <h4 className="text-sm font-bold">Zapotrzebowanie na zasoby ({needs.length})</h4>
        </div>
        {canManageNeeds && (
          <button
            type="button"
            onClick={() => setEditingNeeds(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edytuj zapotrzebowanie
          </button>
        )}
      </div>

      {needs.length === 0 ? (
        <p className="text-xs text-slate-400">Brak zgłoszonego zapotrzebowania.</p>
      ) : (
        <div className="space-y-2">
          {needs.map((need) => {
            const urgencyInfo = getNeedUrgencyInfo(need.urgency);
            const remaining = Math.max(0, need.quantityNeeded - need.quantityFulfilled);
            const percent =
              need.quantityNeeded > 0 ? Math.min(100, Math.round((need.quantityFulfilled / need.quantityNeeded) * 100)) : 0;
            const isOpen = !CLOSED_NEED_STATUSES.has(need.status);
            const inOwnStock = isOpen && ownedCategoryIds.has(need.categoryId);

            return (
              <div key={need.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{need.title}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {inOwnStock && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
                        <PackageCheck className="h-3 w-3" />
                        W Twoim magazynie
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xl text-[11px] font-extrabold border uppercase tracking-wider ${urgencyInfo.badgeClass}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${urgencyInfo.dotClass}`} />
                      {urgencyInfo.label}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {remaining > 0 ? `Pozostało do zebrania: ${remaining} ${need.unit}` : 'Zebrano w całości'}
                  </span>
                  <span className="font-semibold text-slate-700">
                    {need.quantityFulfilled} / {need.quantityNeeded} {need.unit} ({percent}%)
                  </span>
                </div>

                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className={`h-full rounded-full ${urgencyInfo.dotClass}`} style={{ width: `${percent}%` }} />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <AllocationContributorsList
                    allocations={need.allocations}
                    currentUserRole={currentUserRole}
                    currentUserOrganizationId={currentUserOrganizationId}
                    alertOrganizationId={alertOrganizationId}
                    alertTitle={alertTitle}
                  />
                  {isOpen && canAllocate && !alertClosed && (
                    <button
                      type="button"
                      onClick={() => setAllocatingNeed(need)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Przydziel zasoby
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingNeeds && (
        <NeedFormModal
          alertId={alertId}
          alertLocationLabel={alertLocationLabel}
          alertDescription={alertDescription}
          existingNeeds={existingNeeds}
          onClose={() => setEditingNeeds(false)}
        />
      )}

      {allocatingNeed && (
        <AllocateResourcesModal
          alertId={alertId}
          alertLocationLabel={alertLocationLabel}
          needId={allocatingNeed.id}
          needTitle={allocatingNeed.title}
          needCategoryId={allocatingNeed.categoryId}
          needQuantityNeeded={allocatingNeed.quantityNeeded}
          needQuantityFulfilled={allocatingNeed.quantityFulfilled}
          needUnit={allocatingNeed.unit}
          remainingQuantity={Math.max(0, allocatingNeed.quantityNeeded - allocatingNeed.quantityFulfilled)}
          currentUserOrganizationId={currentUserOrganizationId}
          onClose={() => setAllocatingNeed(null)}
        />
      )}
    </div>
  );
}
