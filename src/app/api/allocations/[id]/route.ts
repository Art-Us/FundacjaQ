import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { AllocationStatus, ResourceAllocation } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAllocationDonor, isAllocationRecipient, isAdminForGmina } from '@/lib/authz';
import { assertAllocationTransition, AllocationTransitionError, type AllocationActor } from '@/lib/allocations';
import { recordAudit, requestMeta } from '@/lib/auditLog';

export const runtime = 'nodejs';

// The only two manually-triggered transitions (Крок 17/24) — everything past
// RETURN_AGREED (PARTIALLY_RETURNED/RETURNED) is derived automatically from
// return events (Крок 25), never set directly through this endpoint.
const MANUAL_TARGET_STATUSES = ['DELIVERED', 'RETURN_AGREED'] as const;

const updateAllocationSchema = z.object({
  status: z.enum(MANUAL_TARGET_STATUSES),
});

type AllocationWithAlert = ResourceAllocation & { alert: { id: string; gminaId: string; organizationId: string | null } };

/** Which side(s) of `allocation` `user` legitimately is — an allocation can only ever be evaluated for these two roles. */
function actorRolesOf(allocation: AllocationWithAlert, user: { organizationId?: string | null }): AllocationActor[] {
  const actors: AllocationActor[] = [];
  if (isAllocationDonor(allocation, user)) actors.push('DONOR');
  if (isAllocationRecipient(allocation, user)) actors.push('RECIPIENT');
  return actors;
}

/** Whether `current -> next` succeeds for at least one of `actors` (decision #3: some transitions are open to either side). */
function transitionAllowedFor(current: AllocationStatus, next: AllocationStatus, actors: AllocationActor[]): boolean {
  return actors.some((actor) => {
    try {
      assertAllocationTransition(current, next, actor);
      return true;
    } catch (err) {
      if (err instanceof AllocationTransitionError) return false;
      throw err;
    }
  });
}

function inlineSnapshot(allocation: ResourceAllocation): Record<string, unknown> {
  // TODO(Крок 55a): replace with a dedicated snapshotResourceAllocation() in
  // lib/auditLog.ts, once that's added alongside the other resource-module
  // snapshot functions.
  return {
    id: allocation.id,
    needId: allocation.needId,
    alertId: allocation.alertId,
    resourceId: allocation.resourceId,
    categoryId: allocation.categoryId,
    itemName: allocation.itemName,
    quantity: allocation.quantity,
    quantityReturned: allocation.quantityReturned,
    quantityNotReturnable: allocation.quantityNotReturnable,
    unit: allocation.unit,
    donorOrgId: allocation.donorOrgId,
    recipientOrgId: allocation.recipientOrgId,
    status: allocation.status,
    deliveredAt: allocation.deliveredAt,
    returnAgreedAt: allocation.returnAgreedAt,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const target = await prisma.resourceAllocation.findUnique({
    where: { id: params.id },
    include: { alert: { select: { id: true, gminaId: true, organizationId: true } } },
  });
  if (!target) {
    return NextResponse.json({ error: 'Przydział nie istnieje.' }, { status: 404 });
  }

  const parsed = updateAllocationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }
  const nextStatus = parsed.data.status;

  // First: is this transition even a valid edge in the state machine at all
  // (checked against BOTH possible actors), regardless of who's asking.
  if (!transitionAllowedFor(target.status, nextStatus, ['DONOR', 'RECIPIENT'])) {
    return NextResponse.json(
      { error: `Nie można przejść ze statusu ${target.status} do ${nextStatus}.` },
      { status: 400 }
    );
  }

  // Then: does THIS caller hold a role that's allowed to make THIS specific
  // move — a global ADMIN is exempt, a gmina-scoped ADMIN only within their
  // own gmina (isAdminForGmina, mirrors canManageAlert's rule), everyone
  // else must actually be the donor or recipient organization.
  if (!isAdminForGmina(user, target.alert.gminaId)) {
    const actors = actorRolesOf(target, user);
    if (actors.length === 0) {
      return NextResponse.json({ error: 'Nie masz uprawnień do zmiany statusu tego przydziału.' }, { status: 403 });
    }
    if (!transitionAllowedFor(target.status, nextStatus, actors)) {
      return NextResponse.json(
        { error: 'Nie masz uprawnień do wykonania tej zmiany statusu.' },
        { status: 403 }
      );
    }
  }

  const now = new Date();
  let allocation;
  try {
    allocation = await prisma.resourceAllocation.update({
      where: { id: target.id },
      data: {
        status: nextStatus,
        ...(nextStatus === 'DELIVERED' ? { deliveredAt: now } : {}),
        ...(nextStatus === 'RETURN_AGREED' ? { returnAgreedAt: now } : {}),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się zaktualizować przydziału.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'RESOURCE_ALLOCATION_STATUS_CHANGE',
    entityType: 'RESOURCE_ALLOCATION',
    entityId: allocation.id,
    gminaId: target.alert.gminaId,
    before: inlineSnapshot(target),
    after: inlineSnapshot(allocation),
    meta: requestMeta(req),
  });

  return NextResponse.json({ allocation });
}
