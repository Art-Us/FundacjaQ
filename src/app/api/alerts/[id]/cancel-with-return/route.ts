import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { publishAlertChange } from '@/lib/alertEvents';
import { requireAdminOrCoordinator, isAlertOwnerOrg } from '@/lib/authz';
import {
  sumReturnEvents,
  recalculateAllocationStatus,
  resourceCountersAfterReturnEvent,
  recalculateNeedFulfillment,
} from '@/lib/allocations';
import { recordAudit, requestMeta } from '@/lib/auditLog';
import { describeCheckViolation } from '@/lib/dbErrors';

export const runtime = 'nodejs';

const returnDecisionSchema = z
  .object({
    allocationId: z.string().min(1),
    quantityReturned: z.number().int().min(0).default(0),
    quantityNotReturnable: z.number().int().min(0).default(0),
    notReturnableReason: z.string().trim().max(500).optional(),
    message: z.string().trim().max(2000).optional(),
    returnedAt: z.coerce.date(),
  })
  .refine((data) => data.quantityReturned + data.quantityNotReturnable > 0, {
    message: 'Podaj zwróconą lub nie podlegającą zwrotowi ilość większą od zera dla każdego przydziału.',
  });

const cancelWithReturnSchema = z
  .object({ returns: z.array(returnDecisionSchema) })
  .refine((data) => new Set(data.returns.map((r) => r.allocationId)).size === data.returns.length, {
    message: 'Zduplikowany identyfikator przydziału w decyzjach o zwrocie.',
  });

interface PendingAudit {
  action: AuditAction;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

// R8 — the alert's OWNER organization cancelling its own alert must settle
// every resource it actually received before the alert closes; this is
// deliberately narrower than PATCH /api/alerts/[id]'s ADMIN-can-always-manage
// rule (нюанс #5: an ADMIN cancelling ANOTHER org's alert does NOT go through
// this form — that stays the plain, simpler PATCH path, with the recipient
// settling remaining allocations afterwards via the /zasoby inbox instead).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await prisma.alert.findUnique({ where: { id: params.id } });
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }
  if (!isAlertOwnerOrg(alert, user)) {
    return NextResponse.json(
      { error: 'Tylko organizacja właściciela alertu może anulować go w ten sposób.' },
      { status: 403 }
    );
  }
  if (alert.status === 'CANCELLED') {
    return NextResponse.json({ error: 'Ten alert jest już anulowany.' }, { status: 409 });
  }

  const parsed = cancelWithReturnSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const nonTerminalAllocations = await prisma.resourceAllocation.findMany({
    where: { alertId: alert.id, status: { notIn: ['RETURNED', 'CANCELLED'] } },
  });
  // R8 scopes the required decisions to what was actually RECEIVED — an
  // allocation still awaiting delivery never reached the recipient, so it's
  // withdrawn automatically below instead of going through a return event
  // (nothing was ever removed from the donor's stock to write off).
  const deliveredAllocations = nonTerminalAllocations.filter((a) => a.status !== 'DELIVERY_AGREED');
  const undeliveredAllocations = nonTerminalAllocations.filter((a) => a.status === 'DELIVERY_AGREED');

  const deliveredById = new Map(deliveredAllocations.map((a) => [a.id, a]));
  const providedIds = new Set(parsed.data.returns.map((r) => r.allocationId));

  const missingAllocationIds = deliveredAllocations.filter((a) => !providedIds.has(a.id)).map((a) => a.id);
  if (missingAllocationIds.length > 0) {
    return NextResponse.json(
      {
        error: 'Musisz uzupełnić decyzję o zwrocie dla każdego dostarczonego zasobu.',
        code: 'MISSING_RETURN_DECISIONS',
        missingAllocationIds,
      },
      { status: 409 }
    );
  }

  const invalidEntry = parsed.data.returns.find((r) => !deliveredById.has(r.allocationId));
  if (invalidEntry) {
    return NextResponse.json({ error: 'Nieprawidłowy identyfikator przydziału w decyzjach o zwrocie.' }, { status: 400 });
  }

  // нюанс #7 — validate each decision against its allocation's own full
  // return-event history before touching anything.
  for (const entry of parsed.data.returns) {
    const allocation = deliveredById.get(entry.allocationId)!;
    const existingEvents = await prisma.allocationReturnEvent.findMany({
      where: { allocationId: allocation.id },
      select: { quantityReturned: true, quantityNotReturnable: true },
    });
    const { totalReturned, totalNotReturnable } = sumReturnEvents(existingEvents);
    const projectedTotal = totalReturned + totalNotReturnable + entry.quantityReturned + entry.quantityNotReturnable;
    if (projectedTotal > allocation.quantity) {
      return NextResponse.json(
        { error: `Łączna ilość dla przydziału „${allocation.itemName}” przekroczyłaby jego ilość.` },
        { status: 409 }
      );
    }
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const auditEntries: PendingAudit[] = [];

      for (const entry of parsed.data.returns) {
        const allocation = deliveredById.get(entry.allocationId)!;
        const returnEvent = await tx.allocationReturnEvent.create({
          data: {
            allocationId: allocation.id,
            quantityReturned: entry.quantityReturned,
            quantityNotReturnable: entry.quantityNotReturnable,
            notReturnableReason: entry.notReturnableReason || null,
            message: entry.message || null,
            returnedAt: entry.returnedAt,
            recordedById: user.id,
          },
        });

        const allEvents = await tx.allocationReturnEvent.findMany({
          where: { allocationId: allocation.id },
          select: { quantityReturned: true, quantityNotReturnable: true },
        });
        const { totalReturned, totalNotReturnable } = sumReturnEvents(allEvents);
        const nextStatus = recalculateAllocationStatus(allocation.quantity, allEvents, allocation.status);
        const updated = await tx.resourceAllocation.update({
          where: { id: allocation.id },
          data: { quantityReturned: totalReturned, quantityNotReturnable: totalNotReturnable, status: nextStatus },
        });

        if (allocation.resourceId) {
          const { reservedQuantityDelta, quantityDelta } = resourceCountersAfterReturnEvent(returnEvent);
          await tx.resource.update({
            where: { id: allocation.resourceId },
            data: { reservedQuantity: { increment: reservedQuantityDelta }, quantity: { increment: quantityDelta } },
          });
        }

        auditEntries.push({
          action: 'RESOURCE_ALLOCATION_RETURN',
          entityId: allocation.id,
          before: { status: allocation.status, quantityReturned: allocation.quantityReturned },
          after: { status: updated.status, quantityReturned: updated.quantityReturned, returnEventId: returnEvent.id },
        });
      }

      for (const allocation of undeliveredAllocations) {
        await tx.resourceAllocation.update({ where: { id: allocation.id }, data: { status: 'CANCELLED' } });
        if (allocation.resourceId) {
          await tx.resource.update({
            where: { id: allocation.resourceId },
            data: { reservedQuantity: { decrement: allocation.quantity } },
          });
        }
        auditEntries.push({
          action: 'RESOURCE_ALLOCATION_STATUS_CHANGE',
          entityId: allocation.id,
          before: { status: allocation.status },
          after: { status: 'CANCELLED' },
        });
      }

      // Close every one of this alert's needs (a cancelled alert has nothing
      // left to fulfil) except ones the owner already explicitly cancelled
      // (Крок 22) — those stay CANCELLED, not relabeled CLOSED.
      const needs = await tx.alertNeed.findMany({ where: { alertId: alert.id, status: { not: 'CANCELLED' } } });
      for (const need of needs) {
        const needAllocations = await tx.resourceAllocation.findMany({
          where: { needId: need.id },
          select: { status: true, quantity: true },
        });
        const { quantityFulfilled } = recalculateNeedFulfillment(need.quantityNeeded, needAllocations, need.status);
        await tx.alertNeed.update({ where: { id: need.id }, data: { quantityFulfilled, status: 'CLOSED' } });
      }

      const updatedAlert = await tx.alert.update({ where: { id: alert.id }, data: { status: 'CANCELLED' } });

      return { updatedAlert, auditEntries };
    });
  } catch (err) {
    // Same snapshot-vs-reality gap as return-events: the per-allocation
    // projectedTotal check above can be stale by the time the transaction
    // runs. A CHECK violation (Крок 3) rolls the whole cancel back — nothing
    // is half-applied — so a 409 asking to reload is the right answer.
    const violation = describeCheckViolation(err);
    if (violation) {
      return NextResponse.json({ error: violation.message }, { status: 409 });
    }
    console.error('[cancel-with-return] transaction failed:', err);
    return NextResponse.json({ error: 'Nie udało się anulować alertu.' }, { status: 500 });
  }

  const meta = requestMeta(req);
  for (const entry of result.auditEntries) {
    await recordAudit({
      actor: user,
      action: entry.action,
      entityType: 'RESOURCE_ALLOCATION',
      entityId: entry.entityId,
      gminaId: alert.gminaId,
      before: entry.before,
      after: entry.after,
      meta,
    });
  }

  await publishAlertChange(alert.id);
  return NextResponse.json({ message: 'Alert anulowany.', alert: result.updatedAlert });
}
