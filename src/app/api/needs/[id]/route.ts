import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, type AlertNeed } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAlertOwnerOrg } from '@/lib/authz';
import { recordAudit, requestMeta } from '@/lib/auditLog';
import { describeCheckViolation } from '@/lib/dbErrors';

export const runtime = 'nodejs';

const NEED_URGENCIES = ['NORMAL', 'PILNE', 'KRYTYCZNY'] as const;
// OPEN/PARTIALLY_FULFILLED/FULFILLED are derived automatically from
// allocations (see recalculateNeedFulfillment in lib/allocations.ts) — the
// only statuses this endpoint lets the owner org set by hand are the two
// terminal ones that represent a deliberate decision to stop tracking the
// need, not a fulfillment level.
const MANUAL_NEED_STATUSES = ['CLOSED', 'CANCELLED'] as const;

const updateNeedSchema = z.object({
  categoryId: z.string().min(1).optional(),
  title: z.string().trim().min(1, 'Tytuł jest wymagany.').max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  quantityNeeded: z.number().int().min(1, 'Ilość musi być większa od zera.').optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  urgency: z.enum(NEED_URGENCIES).optional(),
  status: z.enum(MANUAL_NEED_STATUSES).optional(),
});

function inlineSnapshot(need: AlertNeed): Record<string, unknown> {
  // TODO(Крок 55a): replace with a dedicated snapshotAlertNeed() in
  // lib/auditLog.ts, once that's added alongside the other resource-module
  // snapshot functions.
  return {
    id: need.id,
    alertId: need.alertId,
    categoryId: need.categoryId,
    title: need.title,
    description: need.description,
    quantityNeeded: need.quantityNeeded,
    quantityFulfilled: need.quantityFulfilled,
    unit: need.unit,
    urgency: need.urgency,
    status: need.status,
  };
}

async function findNeedWithAlert(id: string) {
  return prisma.alertNeed.findUnique({
    where: { id },
    include: { alert: { select: { id: true, gminaId: true, organizationId: true } } },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const target = await findNeedWithAlert(params.id);
  if (!target) {
    return NextResponse.json({ error: 'Zapotrzebowanie nie istnieje.' }, { status: 404 });
  }
  if (user.role !== 'ADMIN' && !isAlertOwnerOrg(target.alert, user)) {
    return NextResponse.json(
      { error: 'Tylko organizacja właściciela alertu może edytować to zapotrzebowanie.' },
      { status: 403 }
    );
  }

  const parsed = updateNeedSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Brak zmian do zapisania.' }, { status: 400 });
  }

  const { categoryId, quantityNeeded, ...rest } = parsed.data;

  if (categoryId !== undefined) {
    const category = await prisma.resourceCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) {
      return NextResponse.json({ error: 'Wybrana kategoria nie istnieje.' }, { status: 400 });
    }
  }

  // Mirrors the same "can't shrink below what's already committed" guard as
  // PATCH /api/resources/[id] (Крок 19) — quantityFulfilled only ever grows
  // through real allocations, so a need can never owe less than that.
  if (quantityNeeded !== undefined && quantityNeeded < target.quantityFulfilled) {
    return NextResponse.json(
      { error: 'Nie można ustawić ilości poniżej już przydzielonej w aktywnych przydziałach.' },
      { status: 409 }
    );
  }

  const data: Prisma.AlertNeedUpdateInput = { ...rest };
  if (categoryId !== undefined) data.category = { connect: { id: categoryId } };
  if (quantityNeeded !== undefined) data.quantityNeeded = quantityNeeded;

  let need;
  try {
    need = await prisma.alertNeed.update({ where: { id: target.id }, data });
  } catch (err) {
    // Snapshot check above vs. a donor allocating in the same instant — the
    // CHECK constraint need_fulfilled_within_needed (Крок 3) has the final say.
    const violation = describeCheckViolation(err);
    if (violation) {
      return NextResponse.json(
        { error: 'Nie można ustawić ilości poniżej już przydzielonej w aktywnych przydziałach.' },
        { status: 409 }
      );
    }
    console.error('[needs] update failed:', err);
    return NextResponse.json({ error: 'Nie udało się zaktualizować zapotrzebowania.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'ALERT_NEED_UPDATE',
    entityType: 'ALERT_NEED',
    entityId: need.id,
    gminaId: target.alert.gminaId,
    before: inlineSnapshot(target),
    after: inlineSnapshot(need),
    meta: requestMeta(req),
  });

  return NextResponse.json({ need });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const target = await findNeedWithAlert(params.id);
  if (!target) {
    return NextResponse.json({ error: 'Zapotrzebowanie nie istnieje.' }, { status: 404 });
  }
  if (user.role !== 'ADMIN' && !isAlertOwnerOrg(target.alert, user)) {
    return NextResponse.json(
      { error: 'Tylko organizacja właściciela alertu może usunąć to zapotrzebowanie.' },
      { status: 403 }
    );
  }

  // A need with any allocation still in flight (i.e. not yet RETURNED or
  // CANCELLED) can't just disappear — ResourceAllocation.needId is SetNull,
  // so deleting here would silently orphan an active promise from a donor.
  const activeAllocations = await prisma.resourceAllocation.count({
    where: { needId: target.id, status: { notIn: ['RETURNED', 'CANCELLED'] } },
  });
  if (activeAllocations > 0) {
    return NextResponse.json(
      { error: 'Nie można usunąć zapotrzebowania z aktywnymi przydziałami zasobów.' },
      { status: 409 }
    );
  }

  try {
    await prisma.alertNeed.delete({ where: { id: target.id } });
  } catch {
    return NextResponse.json({ error: 'Nie udało się usunąć zapotrzebowania.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'ALERT_NEED_DELETE',
    entityType: 'ALERT_NEED',
    entityId: target.id,
    gminaId: target.alert.gminaId,
    before: inlineSnapshot(target),
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Zapotrzebowanie usunięte.' });
}
