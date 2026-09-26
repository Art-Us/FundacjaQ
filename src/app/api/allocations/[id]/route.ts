import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { AllocationStatus, ResourceAllocation } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  requireAdminOrCoordinator,
  isAllocationDonor,
  isAllocationRecipient,
  isAdminForGmina,
  canEditAllocationQuantity,
} from '@/lib/authz';
import {
  assertAllocationTransition,
  AllocationTransitionError,
  recalculateNeedFulfillment,
  type AllocationActor,
} from '@/lib/allocations';
import { recordAudit, requestMeta } from '@/lib/auditLog';
import { describeCheckViolation } from '@/lib/dbErrors';

export const runtime = 'nodejs';

// The only manually-triggered transitions (Крок 17/24) — everything past
// RETURN_AGREED (PARTIALLY_RETURNED/RETURNED) is derived automatically from
// return events (Крок 25), never set directly through this endpoint.
// CANCELLED lets a donor withdraw its own still-unconfirmed offer (see
// assertAllocationTransition in lib/allocations.ts).
const MANUAL_TARGET_STATUSES = ['DELIVERED', 'RETURN_AGREED', 'CANCELLED'] as const;

const updateStatusSchema = z.object({
  status: z.enum(MANUAL_TARGET_STATUSES),
});

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(1, 'Ilość musi być większa od zera.'),
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

// Edits to an already-created allocation are a completely different shape of
// change from a status transition (a quantity correction vs. an irreversible
// state-machine move), so the request body's own shape — `quantity` vs.
// `status` — picks which handler runs, rather than a separate route/method.
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

  const body = await req.json().catch(() => null);
  if (body && typeof body === 'object' && !Array.isArray(body) && 'quantity' in body) {
    return handleQuantityEdit(req, user, target, body);
  }

  return handleStatusChange(req, user, target, body);
}

async function handleStatusChange(
  req: NextRequest,
  user: NonNullable<Awaited<ReturnType<typeof requireAdminOrCoordinator>>>,
  target: AllocationWithAlert,
  body: unknown
) {
  const parsed = updateStatusSchema.safeParse(body);
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
    // CANCELLED is the one manual transition that undoes a live reservation
    // (DELIVERED/RETURN_AGREED never touch reservedQuantity — only an actual
    // return event does), so it alone needs the resource/need released in the
    // same transaction, mirroring the quantity-edit path below.
    if (nextStatus === 'CANCELLED') {
      const [resource, need] = await Promise.all([
        target.resourceId ? prisma.resource.findUnique({ where: { id: target.resourceId } }) : null,
        target.needId ? prisma.alertNeed.findUnique({ where: { id: target.needId } }) : null,
      ]);

      allocation = await prisma.$transaction(async (tx) => {
        if (resource) {
          await tx.resource.update({
            where: { id: resource.id },
            data: { reservedQuantity: { decrement: target.quantity } },
          });
        }

        const updated = await tx.resourceAllocation.update({
          where: { id: target.id },
          data: { status: 'CANCELLED' },
        });

        if (need) {
          const needAllocations = await tx.resourceAllocation.findMany({
            where: { needId: need.id },
            select: { status: true, quantity: true },
          });
          const { quantityFulfilled, status } = recalculateNeedFulfillment(
            need.quantityNeeded,
            needAllocations,
            need.status
          );
          await tx.alertNeed.update({ where: { id: need.id }, data: { quantityFulfilled, status } });
        }

        return updated;
      });
    } else {
      allocation = await prisma.resourceAllocation.update({
        where: { id: target.id },
        data: {
          status: nextStatus,
          ...(nextStatus === 'DELIVERED' ? { deliveredAt: now } : {}),
          ...(nextStatus === 'RETURN_AGREED' ? { returnAgreedAt: now } : {}),
        },
      });
    }
  } catch (err) {
    const violation = describeCheckViolation(err);
    if (violation) {
      return NextResponse.json({ error: violation.message }, { status: 409 });
    }
    console.error('[allocations] status change failed:', err);
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

// Thrown from inside the quantity-edit transaction when the atomic guard
// below (mirrors POST /api/alerts/[id]/allocations's own resource/need locks)
// finds the new amount no longer fits — either a concurrent change ate the
// room this edit needed, or the new number itself was simply too big to
// begin with. Either way it's a 409, never a 500.
class AllocationEditConflictError extends Error {}

const EDIT_RESOURCE_CONFLICT_MESSAGE = 'Nowa ilość przekracza dostępną ilość tego zasobu.';
const EDIT_NEED_CONFLICT_MESSAGE = 'Nowa ilość przekracza brakującą ilość zapotrzebowania.';

// Lets the donor fix a typo'd digit before anyone has acted on the delivery
// (decision from the "wrong quantity" report) — gated to DELIVERY_AGREED only
// by canEditAllocationQuantity, since past that point the recipient may
// already be relying on the confirmed amount.
async function handleQuantityEdit(
  req: NextRequest,
  user: NonNullable<Awaited<ReturnType<typeof requireAdminOrCoordinator>>>,
  target: AllocationWithAlert,
  body: unknown
) {
  const parsed = updateQuantitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  if (!canEditAllocationQuantity(target, user)) {
    if (target.status !== 'DELIVERY_AGREED') {
      return NextResponse.json(
        { error: 'Ilość można edytować tylko przed potwierdzeniem dostawy.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Tylko organizacja-dawca może edytować ten przydział.' }, { status: 403 });
  }

  const newQuantity = parsed.data.quantity;
  if (newQuantity === target.quantity) {
    return NextResponse.json({ allocation: target });
  }
  const delta = newQuantity - target.quantity;

  const [resource, need] = await Promise.all([
    target.resourceId ? prisma.resource.findUnique({ where: { id: target.resourceId } }) : null,
    target.needId ? prisma.alertNeed.findUnique({ where: { id: target.needId } }) : null,
  ]);

  let allocation;
  try {
    allocation = await prisma.$transaction(async (tx) => {
      // Same lock order as POST /api/alerts/[id]/allocations: resource → need
      // → allocation. Both guards below use the OUTER snapshot's stable value
      // (resource.quantity / need.quantityNeeded only ever move through
      // return events / need edits, never through this path) against the
      // LIVE reservedQuantity/quantityFulfilled column, so a concurrent
      // allocation or return racing this edit is what a 0-row update here
      // actually catches — not a stale read.
      if (resource) {
        const reserved = await tx.resource.updateMany({
          where: { id: resource.id, reservedQuantity: { lte: resource.quantity - delta } },
          data: { reservedQuantity: { increment: delta } },
        });
        if (reserved.count === 0) throw new AllocationEditConflictError(EDIT_RESOURCE_CONFLICT_MESSAGE);
      }

      if (need) {
        const needReserved = await tx.alertNeed.updateMany({
          where: {
            id: need.id,
            status: { notIn: ['CLOSED', 'CANCELLED'] },
            quantityFulfilled: { lte: need.quantityNeeded - delta },
          },
          data: { quantityFulfilled: { increment: delta } },
        });
        if (needReserved.count === 0) throw new AllocationEditConflictError(EDIT_NEED_CONFLICT_MESSAGE);
      }

      const updated = await tx.resourceAllocation.update({
        where: { id: target.id },
        data: { quantity: newQuantity },
      });

      if (need) {
        // Recompute from the actual rows (now including this edit) rather
        // than trusting the increment above alone — same reasoning as POST's
        // own recompute: keeps "quantityFulfilled derived from allocations"
        // an actual invariant, not just true by construction this one time.
        const needAllocations = await tx.resourceAllocation.findMany({
          where: { needId: need.id },
          select: { status: true, quantity: true },
        });
        const { quantityFulfilled, status } = recalculateNeedFulfillment(
          need.quantityNeeded,
          needAllocations,
          need.status
        );
        await tx.alertNeed.update({ where: { id: need.id }, data: { quantityFulfilled, status } });
      }

      return updated;
    });
  } catch (err) {
    if (err instanceof AllocationEditConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const violation = describeCheckViolation(err);
    if (violation) {
      return NextResponse.json({ error: violation.message }, { status: 409 });
    }
    console.error('[allocations] quantity edit failed:', err);
    return NextResponse.json({ error: 'Nie udało się zaktualizować ilości.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'RESOURCE_ALLOCATION_UPDATE',
    entityType: 'RESOURCE_ALLOCATION',
    entityId: allocation.id,
    gminaId: target.alert.gminaId,
    before: inlineSnapshot(target),
    after: inlineSnapshot(allocation),
    meta: requestMeta(req),
  });

  return NextResponse.json({ allocation });
}
