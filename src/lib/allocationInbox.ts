import type { AlertStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const CLOSED_ALERT_STATUSES: AlertStatus[] = ['CANCELLED', 'RESOLVED'];

const include = {
  returnEvents: true,
  alert: { select: { id: true, title: true, status: true } },
  category: { select: { id: true, name: true, group: true } },
} as const;

/** One row of either inbox section — shared with AllocationInboxPanel.tsx (Крок 36) so it doesn't redeclare this shape. */
export type AllocationInboxRow = Prisma.ResourceAllocationGetPayload<{ include: typeof include }>;

/** The "needs action" side's filter (Крок 27) — factored out so the lightweight count below can't drift from the full query. */
function recipientWhere(organizationId: string): Prisma.ResourceAllocationWhereInput {
  return {
    alert: { organizationId, status: { in: CLOSED_ALERT_STATUSES } },
    status: { notIn: ['RETURNED', 'CANCELLED'] },
  };
}

/**
 * R7's derived "needs action" inbox — there's no Notification model in this
 * system (see docs/are-you-familiar-with-tidy-blum.md §5), so this is just a
 * query for "what does this organization still owe a decision on", split
 * into two sections the UI (AllocationInboxPanel, Крок 36) renders
 * differently: `recipient` gets a "Zwróć zasoby" button per row (only the
 * recipient acts — decision #3), `donor` is informational only. Shared by
 * GET /api/allocations/inbox (Крок 27, for client refetches) and the
 * /zasoby server page (Крок 31, for the first paint).
 */
export async function fetchAllocationInbox(
  organizationId: string | null | undefined
): Promise<{ recipient: AllocationInboxRow[]; donor: AllocationInboxRow[] }> {
  if (!organizationId) {
    return { recipient: [], donor: [] };
  }

  const [recipient, donor] = await Promise.all([
    prisma.resourceAllocation.findMany({
      where: recipientWhere(organizationId),
      include,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.resourceAllocation.findMany({
      where: {
        donorOrgId: organizationId,
        alert: { status: { in: CLOSED_ALERT_STATUSES } },
        status: { notIn: ['RETURNED', 'CANCELLED'] },
      },
      include,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return { recipient, donor };
}

/**
 * Just the actionable ("Wymaga działania") count, for the Sidebar badge
 * (Крок 38) — every protected page renders the sidebar, so this deliberately
 * avoids fetchAllocationInbox's full row + include cost (returnEvents, alert,
 * category) when only a number is needed.
 */
export async function countActionableAllocations(organizationId: string | null | undefined): Promise<number> {
  if (!organizationId) {
    return 0;
  }
  return prisma.resourceAllocation.count({ where: recipientWhere(organizationId) });
}
