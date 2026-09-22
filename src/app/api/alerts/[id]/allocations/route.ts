import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAlertOwnerOrg } from '@/lib/authz';
import { recalculateNeedFulfillment } from '@/lib/allocations';
import { recordAudit, requestMeta } from '@/lib/auditLog';
import { describeCheckViolation } from '@/lib/dbErrors';

export const runtime = 'nodejs';

const createAllocationSchema = z.object({
  needId: z.string().min(1, 'Zapotrzebowanie jest wymagane.'),
  resourceId: z.string().min(1, 'Zasób jest wymagany.'),
  quantity: z.number().int().min(1, 'Ilość musi być większa od zera.'),
});

// Thrown from inside the allocation transaction when one of the atomic
// guards (see POST below) finds the resource or the need no longer has room
// — i.e. a concurrent allocation got there first. Surfaced as 409, exactly
// like the pre-transaction checks it backs up, never as a 500.
class AllocationConflictError extends Error {}

const RESOURCE_CONFLICT_MESSAGE = 'Zbyt mała dostępna ilość tego zasobu — ktoś właśnie przydzielił jego część.';
const NEED_CONFLICT_MESSAGE =
  'Przekracza brakującą ilość zapotrzebowania — ktoś właśnie przydzielił zasoby do tej potrzeby.';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await prisma.alert.findUnique({
    where: { id: params.id },
    select: { id: true, gminaId: true, organizationId: true },
  });
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }

  // Same gmina-scoping as GET /api/alerts/[id]/needs — visible to any donor
  // in the alert's gmina, not only its owner organization.
  if (user.role !== 'ADMIN' && alert.gminaId !== user.gminaId) {
    return NextResponse.json({ error: 'Nie masz uprawnień do przeglądania przydziałów tego alertu.' }, { status: 403 });
  }

  const allocations = await prisma.resourceAllocation.findMany({
    where: { alertId: alert.id },
    include: {
      category: { select: { id: true, name: true, group: true } },
      donorOrg: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ allocations });
}

// "Przydziel zasoby" (R11) — any organization with a matching resource may
// donate toward a need, regardless of gmina (crisis response crosses gmina
// boundaries — see нюанс #4, docs/resource_management_plan.md §7). Ownership
// is always the caller's own organization, same restriction as
// POST /api/resources (Крок 18): even an ADMIN needs an organization of
// their own to be a donor.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json(
      { error: 'Nie masz przypisanej organizacji — nie możesz przydzielać zasobów.' },
      { status: 400 }
    );
  }

  const alert = await prisma.alert.findUnique({ where: { id: params.id } });
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }
  // The alert's own owner organization can't donate to its own need — it
  // already has whatever it would be offering, so "Przydziel zasoby" here
  // would just be moving stock within its own inventory dressed up as a
  // donation from someone else.
  if (isAlertOwnerOrg(alert, user)) {
    return NextResponse.json(
      { error: 'Organizacja właściciela alertu nie może przydzielać zasobów do własnego alertu.' },
      { status: 403 }
    );
  }
  // A closed alert (Rozwiązany/Odwołany) is done accepting help — allocating
  // against it would strand reservedQuantity on the donor's resource with no
  // path back (cancel-with-return only runs for the owner's own cancellation,
  // never for a plain PATCH to RESOLVED, and never after the fact here).
  if (alert.status === 'RESOLVED' || alert.status === 'CANCELLED') {
    return NextResponse.json({ error: 'Ten alert jest już zamknięty.' }, { status: 409 });
  }

  const parsed = createAllocationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const need = await prisma.alertNeed.findUnique({ where: { id: parsed.data.needId } });
  if (!need || need.alertId !== alert.id) {
    return NextResponse.json({ error: 'Zapotrzebowanie nie istnieje dla tego alertu.' }, { status: 404 });
  }
  // OPEN/PARTIALLY_FULFILLED/FULFILLED can all still receive more (fulfilled
  // just means "covered so far", not "closed to more help") — only a need
  // the owner org deliberately closed or cancelled (Крок 22) rejects new offers.
  if (need.status === 'CLOSED' || need.status === 'CANCELLED') {
    return NextResponse.json({ error: 'To zapotrzebowanie zostało zamknięte.' }, { status: 409 });
  }

  // Hard cap: a single donation can never push the need past what it still
  // lacks — `quantityFulfilled` is kept in sync with the sum of every
  // non-cancelled allocation by recalculateNeedFulfillment() below, so this
  // is the true remaining amount, not a client-supplied figure.
  const stillNeeded = need.quantityNeeded - need.quantityFulfilled;
  if (parsed.data.quantity > stillNeeded) {
    return NextResponse.json(
      { error: `Przekracza brakującą ilość zapotrzebowania (brakuje ${stillNeeded} ${need.unit}).` },
      { status: 409 }
    );
  }

  const resource = await prisma.resource.findUnique({ where: { id: parsed.data.resourceId } });
  if (!resource) {
    return NextResponse.json({ error: 'Zasób nie istnieje.' }, { status: 404 });
  }
  if (resource.organizationId !== user.organizationId) {
    return NextResponse.json({ error: 'Możesz przydzielać tylko zasoby własnej organizacji.' }, { status: 403 });
  }

  const available = resource.quantity - resource.reservedQuantity;
  if (parsed.data.quantity > available) {
    return NextResponse.json({ error: 'Zbyt mała dostępna ilość tego zasobu.' }, { status: 409 });
  }

  // The two checks above (and the CLOSED/CANCELLED one) ran on a snapshot
  // read outside any transaction — two donors allocating the same resource at
  // the same moment both pass them. So they are only a fast, friendly 409;
  // the real guard is below, where the check and the write are ONE statement
  // each: `updateMany` with the remaining-room condition in `where`. Postgres
  // takes the row lock, re-evaluates the condition against the latest
  // committed row, and either updates it (count 1) or doesn't (count 0) —
  // exactly one of two concurrent callers can win. Default READ COMMITTED
  // isolation is what makes this work without retries: the second caller
  // simply blocks on the row lock, then sees the winner's increment.
  //
  // Lock order is always resource → need → allocation, so two concurrent
  // allocations can't deadlock each other.
  const quantity = parsed.data.quantity;
  let allocation;
  try {
    allocation = await prisma.$transaction(async (tx) => {
      const reserved = await tx.resource.updateMany({
        where: {
          id: resource.id,
          // Ownership is re-checked inside the same atomic statement, not
          // only on the snapshot above.
          organizationId: user.organizationId!,
          // "reservedQuantity + quantity <= resource.quantity", written so the
          // column stands alone on the left (Prisma can't express column
          // arithmetic in `where`). resource.quantity is the snapshot value —
          // the DB CHECK constraint (plan Крок 3) covers a concurrent shrink.
          reservedQuantity: { lte: resource.quantity - quantity },
        },
        data: { reservedQuantity: { increment: quantity } },
      });
      if (reserved.count === 0) throw new AllocationConflictError(RESOURCE_CONFLICT_MESSAGE);

      // Same idea for the need: the increment only lands if the need is still
      // open AND still has at least `quantity` uncovered. This also closes the
      // gap where the owner org closes the need in the same instant.
      const needReserved = await tx.alertNeed.updateMany({
        where: {
          id: need.id,
          status: { notIn: ['CLOSED', 'CANCELLED'] },
          quantityFulfilled: { lte: need.quantityNeeded - quantity },
        },
        data: { quantityFulfilled: { increment: quantity } },
      });
      if (needReserved.count === 0) throw new AllocationConflictError(NEED_CONFLICT_MESSAGE);

      const created = await tx.resourceAllocation.create({
        data: {
          needId: need.id,
          alertId: alert.id,
          resourceId: resource.id,
          categoryId: resource.categoryId,
          itemName: resource.name,
          quantity,
          unit: resource.unit,
          donorOrgId: user.organizationId!,
          recipientOrgId: alert.organizationId,
          createdById: user.id,
        },
      });

      // quantityFulfilled was already bumped atomically above; this recompute
      // from the actual allocation rows (which, holding the need's row lock,
      // now include every committed concurrent one) keeps the "derived from
      // allocations" invariant the rest of the module relies on, and is what
      // produces the need's PARTIALLY_FULFILLED/FULFILLED status.
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

      return created;
    });
  } catch (err) {
    if (err instanceof AllocationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // The DB CHECK constraints (Крок 3) are the last line of defence — e.g.
    // Resource.quantity shrank between our snapshot read and the updateMany
    // above. That's a conflict with a concurrent edit, not a server fault.
    const violation = describeCheckViolation(err);
    if (violation) {
      return NextResponse.json({ error: violation.message }, { status: 409 });
    }
    console.error('[allocations] create failed:', err);
    return NextResponse.json({ error: 'Nie udało się przydzielić zasobu.' }, { status: 500 });
  }

  // TODO(Крок 55a): replace this inline allowlist with a dedicated
  // snapshotResourceAllocation() in lib/auditLog.ts, once that's added
  // alongside the other resource-module snapshot functions.
  await recordAudit({
    actor: user,
    action: 'RESOURCE_ALLOCATION_CREATE',
    entityType: 'RESOURCE_ALLOCATION',
    entityId: allocation.id,
    gminaId: alert.gminaId,
    after: {
      id: allocation.id,
      needId: allocation.needId,
      alertId: allocation.alertId,
      resourceId: allocation.resourceId,
      categoryId: allocation.categoryId,
      itemName: allocation.itemName,
      quantity: allocation.quantity,
      unit: allocation.unit,
      donorOrgId: allocation.donorOrgId,
      recipientOrgId: allocation.recipientOrgId,
      status: allocation.status,
    },
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Zasób przydzielony.', allocation }, { status: 201 });
}
