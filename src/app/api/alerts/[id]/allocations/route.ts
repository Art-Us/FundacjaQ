import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { recalculateNeedFulfillment } from '@/lib/allocations';
import { recordAudit, requestMeta } from '@/lib/auditLog';

export const runtime = 'nodejs';

const createAllocationSchema = z.object({
  needId: z.string().min(1, 'Zapotrzebowanie jest wymagane.'),
  resourceId: z.string().min(1, 'Zasób jest wymagany.'),
  quantity: z.number().int().min(1, 'Ilość musi być większa od zera.'),
});

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

  let allocation;
  try {
    allocation = await prisma.$transaction(async (tx) => {
      const created = await tx.resourceAllocation.create({
        data: {
          needId: need.id,
          alertId: alert.id,
          resourceId: resource.id,
          categoryId: resource.categoryId,
          itemName: resource.name,
          quantity: parsed.data.quantity,
          unit: resource.unit,
          donorOrgId: user.organizationId!,
          recipientOrgId: alert.organizationId,
          createdById: user.id,
        },
      });

      await tx.resource.update({
        where: { id: resource.id },
        data: { reservedQuantity: { increment: parsed.data.quantity } },
      });

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
  } catch {
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
