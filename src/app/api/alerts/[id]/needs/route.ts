import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAlertOwnerOrg } from '@/lib/authz';
import { recordAudit, requestMeta } from '@/lib/auditLog';
import { getCachedAlertAccess, setCachedAlertAccess, type CachedAlertAccess } from '@/lib/alertAccessCache';

export const runtime = 'nodejs';

// Redis-fast-path/Postgres-fallback for the alert lookup below — this route
// only ever needs gminaId/organizationId/status to authorize the request,
// never the rest of the alert record (see alertAccessCache.ts's doc comment).
async function findAlertAccess(id: string): Promise<CachedAlertAccess | null> {
  const cached = await getCachedAlertAccess(id);
  if (cached) return cached;

  const alert = await prisma.alert.findUnique({
    where: { id },
    select: { gminaId: true, organizationId: true, status: true },
  });
  if (!alert) return null;

  await setCachedAlertAccess(id, alert);
  return alert;
}

const NEED_URGENCIES = ['NORMAL', 'PILNE', 'KRYTYCZNY'] as const;

const createNeedSchema = z.object({
  categoryId: z.string().min(1, 'Kategoria jest wymagana.'),
  title: z.string().trim().min(1, 'Tytuł jest wymagany.').max(200),
  description: z.string().trim().max(2000).optional(),
  quantityNeeded: z.number().int().min(1, 'Ilość musi być większa od zera.'),
  unit: z.string().trim().min(1).max(20).default('szt'),
  urgency: z.enum(NEED_URGENCIES).default('NORMAL'),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await findAlertAccess(params.id);
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }

  // Same gmina-scoping as PATCH /api/alerts/[id]: any donor org (ADMIN, or a
  // COORDINATOR in the same gmina) needs to see what's needed in order to
  // offer resources — this is deliberately NOT restricted to the alert's own
  // owner organization, unlike POST below.
  if (user.role !== 'ADMIN' && alert.gminaId !== user.gminaId) {
    return NextResponse.json({ error: 'Nie masz uprawnień do przeglądania potrzeb tego alertu.' }, { status: 403 });
  }

  const needs = await prisma.alertNeed.findMany({
    where: { alertId: params.id },
    include: { category: { select: { id: true, name: true, group: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ needs });
}

// Only the alert's own owner organization may declare what it needs — a
// donor organization reacts to these (POST /api/alerts/[id]/allocations,
// Крок 23), it never states them on the recipient's behalf.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await findAlertAccess(params.id);
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }
  if (user.role !== 'ADMIN' && !isAlertOwnerOrg(alert, user)) {
    return NextResponse.json(
      { error: 'Tylko organizacja właściciela alertu może zgłaszać zapotrzebowanie.' },
      { status: 403 }
    );
  }

  const parsed = createNeedSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const category = await prisma.resourceCategory.findUnique({
    where: { id: parsed.data.categoryId },
    select: { id: true },
  });
  if (!category) {
    return NextResponse.json({ error: 'Wybrana kategoria nie istnieje.' }, { status: 400 });
  }

  let need;
  try {
    need = await prisma.alertNeed.create({
      data: {
        alertId: params.id,
        categoryId: parsed.data.categoryId,
        title: parsed.data.title,
        description: parsed.data.description || null,
        quantityNeeded: parsed.data.quantityNeeded,
        unit: parsed.data.unit,
        urgency: parsed.data.urgency,
        createdById: user.id,
      },
    });
  } catch (err) {
    // The alert lookup above can come from the cache (findAlertAccess) and
    // go stale if the alert was deleted right after its cache entry was last
    // written — alertId's foreign key is the real, live source of truth, so
    // that specific failure means "alert doesn't exist" (404), not a generic
    // server error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Nie udało się dodać zapotrzebowania.' }, { status: 500 });
  }

  // TODO(Крок 55a): replace this inline allowlist with a dedicated
  // snapshotAlertNeed() in lib/auditLog.ts, once that's added alongside the
  // other resource-module snapshot functions.
  await recordAudit({
    actor: user,
    action: 'ALERT_NEED_CREATE',
    entityType: 'ALERT_NEED',
    entityId: need.id,
    gminaId: alert.gminaId,
    after: {
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
    },
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Zapotrzebowanie dodane.', need }, { status: 201 });
}
