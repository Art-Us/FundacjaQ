import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { scopedGminaWhereAnyAdmin } from '@/lib/gmina';
import { recordAudit, requestMeta } from '@/lib/auditLog';

export const runtime = 'nodejs';

const HORIZONS = ['H24', 'H48', 'H72', 'WEEK'] as const;

const listQuerySchema = z.object({
  organizationId: z.string().optional(),
  categoryId: z.string().optional(),
  horizon: z.enum(HORIZONS).optional(),
});

const createResourceSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana.').max(200),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.string().min(1, 'Kategoria jest wymagana.'),
  quantity: z.number().int().min(0, 'Ilość nie może być ujemna.'),
  unit: z.string().trim().min(1).max(20).default('szt'),
  horizon: z.enum(HORIZONS).default('H24'),
  location: z.string().trim().max(200).optional(),
});

export async function GET(req: NextRequest) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe parametry filtrowania.' }, { status: 400 });
  }

  // Resources stay ADMIN-unconditional (any ADMIN, global or gmina-scoped,
  // sees every gmina's resources) — see scopedGminaWhereAnyAdmin's doc
  // comment. Must still fail closed for a gmina-scoped role with no gmina.
  const gminaFilter = scopedGminaWhereAnyAdmin(user);
  if (gminaFilter === null) {
    return NextResponse.json({ resources: [] });
  }

  const { organizationId, categoryId, horizon } = parsed.data;

  let resources;
  try {
    resources = await prisma.resource.findMany({
      where: {
        ...gminaFilter,
        ...(organizationId ? { organizationId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(horizon ? { horizon } : {}),
      },
      include: {
        category: { select: { id: true, name: true, group: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać listy zasobów.' }, { status: 500 });
  }

  return NextResponse.json({ resources });
}

// A resource always belongs to the caller's own organization (decision #1,
// docs/are-you-familiar-with-tidy-blum.md) — there is no "create on behalf of
// another organization" path here, mirroring the same restriction on
// POST /api/admin/invites for a COORDINATOR's own organization. An ADMIN with
// no organization of their own (the normal, site-wide case — see
// prisma/seed.ts) can't own a resource either, since ownership is always an
// organization's, never an individual admin's.
export async function POST(req: NextRequest) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json(
      { error: 'Nie masz przypisanej organizacji — nie możesz zgłaszać zasobów.' },
      { status: 400 }
    );
  }

  const parsed = createResourceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { id: true, gminaId: true },
  });
  if (!organization) {
    return NextResponse.json(
      { error: 'Twoja organizacja już nie istnieje — skontaktuj się z administratorem.' },
      { status: 400 }
    );
  }

  const category = await prisma.resourceCategory.findUnique({
    where: { id: parsed.data.categoryId },
    select: { id: true },
  });
  if (!category) {
    return NextResponse.json({ error: 'Wybrana kategoria nie istnieje.' }, { status: 400 });
  }

  let resource;
  try {
    resource = await prisma.resource.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        quantity: parsed.data.quantity,
        unit: parsed.data.unit,
        categoryId: parsed.data.categoryId,
        horizon: parsed.data.horizon,
        location: parsed.data.location || null,
        // Derived from the organization, not user-editable — see the
        // gminaId field comment on the Resource model in schema.prisma.
        gminaId: organization.gminaId,
        organizationId: organization.id,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się dodać zasobu.' }, { status: 500 });
  }

  // TODO(Крок 55a): replace this inline allowlist with a dedicated
  // snapshotResource() in lib/auditLog.ts, once that's added alongside the
  // other resource-module snapshot functions.
  await recordAudit({
    actor: user,
    action: 'RESOURCE_CREATE',
    entityType: 'RESOURCE',
    entityId: resource.id,
    gminaId: resource.gminaId,
    after: {
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
    },
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Zasób dodany.', resource }, { status: 201 });
}
