import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { publishAlertChange } from '@/lib/alertEvents';
import { requireAdminOrCoordinator, isAllocationRecipient } from '@/lib/authz';
import { sumReturnEvents, recalculateAllocationStatus, resourceCountersAfterReturnEvent } from '@/lib/allocations';
import { recordAudit, requestMeta } from '@/lib/auditLog';
import { describeCheckViolation } from '@/lib/dbErrors';

export const runtime = 'nodejs';

const createReturnEventSchema = z
  .object({
    quantityReturned: z.number().int().min(0).default(0),
    quantityNotReturnable: z.number().int().min(0).default(0),
    notReturnableReason: z.string().trim().max(500).optional(),
    // R4 — an optional note ("returned 3 of 5, 2 damaged") that must also
    // surface in the /zasoby inbox (Крок 27/36), not just this allocation's
    // own history.
    message: z.string().trim().max(2000).optional(),
    // R5 — filled in by hand in this same form, not defaulted to now().
    returnedAt: z.coerce.date(),
  })
  .refine((data) => data.quantityReturned + data.quantityNotReturnable > 0, {
    message: 'Podaj zwróconą lub nie podlegającą zwrotowi ilość większą od zera.',
  });

// Only the recipient organization physically returns a resource it no longer
// needs (decision #3) — ADMIN is exempt from the organization check, same
// override as PATCH /api/allocations/[id] (Крок 24).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
  if (user.role !== 'ADMIN' && !isAllocationRecipient(target, user)) {
    return NextResponse.json({ error: 'Tylko odbiorca może rejestrować zwrot tego przydziału.' }, { status: 403 });
  }

  // A return can only be recorded once delivery is confirmed AND the
  // recipient has agreed to return it (Крок 24) — recording one against a
  // still-in-transit or already-closed allocation makes no sense.
  if (target.status !== 'RETURN_AGREED' && target.status !== 'PARTIALLY_RETURNED') {
    return NextResponse.json(
      { error: 'Zwrot można zarejestrować dopiero po uzgodnieniu zwrotu (RETURN_AGREED).' },
      { status: 409 }
    );
  }

  const parsed = createReturnEventSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const existingEvents = await prisma.allocationReturnEvent.findMany({
    where: { allocationId: target.id },
    select: { quantityReturned: true, quantityNotReturnable: true },
  });
  const { totalReturned: existingReturned, totalNotReturnable: existingNotReturnable } = sumReturnEvents(existingEvents);
  const projectedTotal =
    existingReturned + existingNotReturnable + parsed.data.quantityReturned + parsed.data.quantityNotReturnable;
  // нюанс #7 — quantityReturned + quantityNotReturnable across the whole
  // history must never exceed the allocation's own quantity.
  if (projectedTotal > target.quantity) {
    return NextResponse.json(
      { error: 'Łączna zwrócona i nie podlegająca zwrotowi ilość przekroczyłaby ilość tego przydziału.' },
      { status: 409 }
    );
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const returnEvent = await tx.allocationReturnEvent.create({
        data: {
          allocationId: target.id,
          quantityReturned: parsed.data.quantityReturned,
          quantityNotReturnable: parsed.data.quantityNotReturnable,
          notReturnableReason: parsed.data.notReturnableReason || null,
          message: parsed.data.message || null,
          returnedAt: parsed.data.returnedAt,
          recordedById: user.id,
        },
      });

      const allEvents = await tx.allocationReturnEvent.findMany({
        where: { allocationId: target.id },
        select: { quantityReturned: true, quantityNotReturnable: true },
      });
      const { totalReturned, totalNotReturnable } = sumReturnEvents(allEvents);
      const nextStatus = recalculateAllocationStatus(target.quantity, allEvents, target.status);

      const allocation = await tx.resourceAllocation.update({
        where: { id: target.id },
        data: { quantityReturned: totalReturned, quantityNotReturnable: totalNotReturnable, status: nextStatus },
      });

      // The source Resource may have been deleted since this allocation was
      // made (resourceId is SetNull) — nothing left to release the
      // reservation against in that case.
      if (target.resourceId) {
        const { reservedQuantityDelta, quantityDelta } = resourceCountersAfterReturnEvent(returnEvent);
        await tx.resource.update({
          where: { id: target.resourceId },
          data: { reservedQuantity: { increment: reservedQuantityDelta }, quantity: { increment: quantityDelta } },
        });
      }

      return { returnEvent, allocation };
    });
  } catch (err) {
    // The projectedTotal check above ran on a snapshot — two returns recorded
    // at once for the same allocation both pass it. The DB CHECK constraint
    // allocation_returns_within_quantity (Крок 3) catches the loser here.
    const violation = describeCheckViolation(err);
    if (violation) {
      return NextResponse.json({ error: violation.message }, { status: 409 });
    }
    console.error('[return-events] create failed:', err);
    return NextResponse.json({ error: 'Nie udało się zarejestrować zwrotu.' }, { status: 500 });
  }

  // TODO(Крок 55a): replace this inline allowlist with a dedicated
  // snapshotResourceAllocation() in lib/auditLog.ts, once that's added
  // alongside the other resource-module snapshot functions.
  await recordAudit({
    actor: user,
    action: 'RESOURCE_ALLOCATION_RETURN',
    entityType: 'RESOURCE_ALLOCATION',
    entityId: target.id,
    gminaId: target.alert.gminaId,
    before: { status: target.status, quantityReturned: target.quantityReturned, quantityNotReturnable: target.quantityNotReturnable },
    after: {
      status: result.allocation.status,
      quantityReturned: result.allocation.quantityReturned,
      quantityNotReturnable: result.allocation.quantityNotReturnable,
      returnEventId: result.returnEvent.id,
    },
    meta: requestMeta(req),
  });

  await publishAlertChange(target.alert.id);
  return NextResponse.json({ allocation: result.allocation, returnEvent: result.returnEvent }, { status: 201 });
}
