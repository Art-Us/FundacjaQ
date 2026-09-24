import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, type Resource } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAdminForGmina, type AuthorizedUser } from '@/lib/authz';
import { recordAudit, requestMeta } from '@/lib/auditLog';
import { describeCheckViolation } from '@/lib/dbErrors';
import {
  getCachedResourceAccess,
  setCachedResourceAccess,
  invalidateResourceAccessCache,
} from '@/lib/resourceAccessCache';

export const runtime = 'nodejs';

const HORIZONS = ['H24', 'H48', 'H72', 'WEEK'] as const;

const updateResourceSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana.').max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: z.string().min(1).optional(),
  quantity: z.number().int().min(0, 'Ilość nie może być ujemna.').optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  horizon: z.enum(HORIZONS).optional(),
  location: z.string().trim().max(200).nullable().optional(),
});

// Own organization, or ADMIN (a global admin unconditionally, a gmina-scoped
// one only within their own gmina — isAdminForGmina) — mirrors the "власна
// організація або ADMIN" guard from docs/resource_management_plan.md Крок 19.
// A COORDINATOR from a DIFFERENT organization gets the same 403 a VOLUNTEER
// would from the module guard one level up, even though both pass
// requireAdminOrCoordinator().
function canManageResource(resource: Pick<Resource, 'organizationId' | 'gminaId'>, user: AuthorizedUser): boolean {
  return isAdminForGmina(user, resource.gminaId) || (!!user.organizationId && user.organizationId === resource.organizationId);
}

/**
 * Fast pre-check ahead of the mandatory full findUnique below — a resource's
 * gminaId/organizationId never change after creation (not in
 * updateResourceSchema), so a cache hit that already disagrees with the
 * caller's organization is a reliable early 403, no Postgres round trip
 * needed. A cache MISS (or a hit that doesn't rule the caller out) still
 * falls through to the real findUnique + canManageResource check below,
 * exactly as before — this never widens access, only sometimes rejects
 * sooner. See resourceAccessCache.ts's doc comment for why this can't also
 * skip that full read on the ALLOWED path (quantity/reservedQuantity/status
 * are genuinely mutable and must come from Postgres every time).
 */
async function rejectEarlyIfDenied(resourceId: string, user: AuthorizedUser): Promise<boolean> {
  if (user.role === 'ADMIN') return false;
  const cached = await getCachedResourceAccess(resourceId);
  return !!cached && cached.organizationId !== user.organizationId;
}

function inlineSnapshot(resource: Resource): Record<string, unknown> {
  // TODO(Крок 55a): replace with a dedicated snapshotResource() in
  // lib/auditLog.ts, once that's added alongside the other resource-module
  // snapshot functions.
  return {
    id: resource.id,
    name: resource.name,
    description: resource.description,
    quantity: resource.quantity,
    unit: resource.unit,
    status: resource.status,
    categoryId: resource.categoryId,
    gminaId: resource.gminaId,
    organizationId: resource.organizationId,
    horizon: resource.horizon,
    location: resource.location,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }
  if (await rejectEarlyIfDenied(params.id, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tego zasobu.' }, { status: 403 });
  }

  const resource = await prisma.resource.findUnique({
    where: { id: params.id },
    include: {
      category: { select: { id: true, name: true, group: true } },
      organization: { select: { id: true, name: true } },
    },
  });
  if (!resource) {
    return NextResponse.json({ error: 'Zasób nie istnieje.' }, { status: 404 });
  }
  if (!canManageResource(resource, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tego zasobu.' }, { status: 403 });
  }

  await setCachedResourceAccess(resource.id, { gminaId: resource.gminaId, organizationId: resource.organizationId });

  return NextResponse.json({ resource });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }
  if (await rejectEarlyIfDenied(params.id, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tego zasobu.' }, { status: 403 });
  }

  const target = await prisma.resource.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'Zasób nie istnieje.' }, { status: 404 });
  }
  if (!canManageResource(target, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tego zasobu.' }, { status: 403 });
  }
  await setCachedResourceAccess(target.id, { gminaId: target.gminaId, organizationId: target.organizationId });

  const parsed = updateResourceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Brak zmian do zapisania.' }, { status: 400 });
  }

  const { categoryId, quantity, ...rest } = parsed.data;

  if (categoryId !== undefined) {
    const category = await prisma.resourceCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) {
      return NextResponse.json({ error: 'Wybrana kategoria nie istnieje.' }, { status: 400 });
    }
  }

  // A donor can't shrink the declared quantity below what's already promised
  // to allocations in flight — see нюанс #6 in docs/resource_management_plan.md.
  if (quantity !== undefined && quantity < target.reservedQuantity) {
    return NextResponse.json(
      { error: 'Nie można ustawić ilości poniżej już zarezerwowanej w aktywnych przydziałach.' },
      { status: 409 }
    );
  }

  const data: Prisma.ResourceUpdateInput = { ...rest };
  if (categoryId !== undefined) data.category = { connect: { id: categoryId } };
  if (quantity !== undefined) data.quantity = quantity;

  let resource;
  try {
    resource = await prisma.resource.update({ where: { id: target.id }, data });
  } catch (err) {
    // The reservedQuantity comparison above used a snapshot; if an allocation
    // reserved more in the meantime, the CHECK constraint
    // resource_reserved_within_quantity (Крок 3) rejects the shrink here.
    const violation = describeCheckViolation(err);
    if (violation) {
      return NextResponse.json(
        { error: 'Nie można ustawić ilości poniżej już zarezerwowanej w aktywnych przydziałach.' },
        { status: 409 }
      );
    }
    console.error('[resources] update failed:', err);
    return NextResponse.json({ error: 'Nie udało się zaktualizować zasobu.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'RESOURCE_UPDATE',
    entityType: 'RESOURCE',
    entityId: resource.id,
    gminaId: resource.gminaId,
    before: inlineSnapshot(target),
    after: inlineSnapshot(resource),
    meta: requestMeta(req),
  });

  return NextResponse.json({ resource });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }
  if (await rejectEarlyIfDenied(params.id, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tego zasobu.' }, { status: 403 });
  }

  const target = await prisma.resource.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'Zasób nie istnieje.' }, { status: 404 });
  }
  if (!canManageResource(target, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tego zasobu.' }, { status: 403 });
  }

  // Deleting a resource that's currently backing an active allocation would
  // strand ResourceAllocation.resourceId (SetNull) while the allocation
  // itself is still live — the donor must resolve those allocations first.
  if (target.reservedQuantity > 0) {
    return NextResponse.json(
      { error: 'Nie można usunąć zasobu, który jest częściowo zarezerwowany w aktywnych przydziałach.' },
      { status: 409 }
    );
  }

  try {
    await prisma.resource.delete({ where: { id: target.id } });
  } catch {
    return NextResponse.json({ error: 'Nie udało się usunąć zasobu.' }, { status: 500 });
  }

  await invalidateResourceAccessCache(target.id);

  await recordAudit({
    actor: user,
    action: 'RESOURCE_DELETE',
    entityType: 'RESOURCE',
    entityId: target.id,
    gminaId: target.gminaId,
    before: inlineSnapshot(target),
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Zasób usunięty.' });
}
