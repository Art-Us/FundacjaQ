import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, isGminaScopedAdmin } from '@/lib/authz';
import { normalizeOrganizationName } from '@/lib/organization';
import { recordAudit, requestMeta, snapshotOrganization } from '@/lib/auditLog';
import { invalidateUserStatusCache } from '@/lib/userStatusCache';

export const runtime = 'nodejs';

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  gminaId: z.string().min(1).optional(),
  street: z.string().trim().max(200).nullable().optional(),
  houseNumber: z.string().trim().max(20).nullable().optional(),
  apartmentNumber: z.string().trim().max(20).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  contactFirstName: z.string().trim().max(120).nullable().optional(),
  contactLastName: z.string().trim().max(120).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .nullable()
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, { message: 'Nieprawidłowy adres email kontaktu.' }),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  let target;
  try {
    target = await prisma.organization.findUnique({ where: { id: params.id } });
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać organizacji.' }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: 'Organizacja nie istnieje.' }, { status: 404 });
  }

  // A gmina-scoped admin may only manage organizations already in their own
  // gmina, and can never move one in or out of it — reassigning gminaId
  // stays global-admin-only, same as gmina creation.
  if (isGminaScopedAdmin(admin) && target.gminaId !== admin.gminaId) {
    return NextResponse.json({ error: 'Nie masz uprawnień do zarządzania tą organizacją.' }, { status: 403 });
  }

  const parsed = updateOrganizationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const {
    name,
    gminaId,
    street,
    houseNumber,
    apartmentNumber,
    city,
    postalCode,
    contactFirstName,
    contactLastName,
    contactPhone,
    contactEmail,
  } = parsed.data;

  if (isGminaScopedAdmin(admin) && gminaId !== undefined && gminaId !== admin.gminaId) {
    return NextResponse.json({ error: 'Nie możesz przenieść organizacji poza własną gminę.' }, { status: 403 });
  }

  const data: Prisma.OrganizationUpdateInput = {};

  const effectiveGminaId = gminaId ?? target.gminaId;
  const effectiveName = name !== undefined ? normalizeOrganizationName(name) : target.name;
  if (name !== undefined && !effectiveName) {
    return NextResponse.json({ error: 'Nazwa organizacji jest wymagana.' }, { status: 400 });
  }

  if (
    (name !== undefined && effectiveName.toLowerCase() !== target.name.toLowerCase()) ||
    (gminaId !== undefined && gminaId !== target.gminaId)
  ) {
    let existing;
    try {
      existing = await prisma.organization.findFirst({
        where: { gminaId: effectiveGminaId, name: { equals: effectiveName, mode: 'insensitive' } },
      });
    } catch {
      return NextResponse.json(
        { error: 'Nie udało się zaktualizować organizacji. Sprawdź podane dane.' },
        { status: 400 }
      );
    }
    if (existing && existing.id !== target.id) {
      return NextResponse.json({ error: 'Organizacja o tej nazwie już istnieje w tej gminie.' }, { status: 409 });
    }
  }

  if (name !== undefined) data.name = effectiveName;
  const isReassigningGmina = gminaId !== undefined && gminaId !== target.gminaId;
  if (isReassigningGmina) {
    let gmina;
    try {
      gmina = await prisma.gmina.findUnique({ where: { id: gminaId }, select: { id: true } });
    } catch {
      return NextResponse.json(
        { error: 'Nie udało się zaktualizować organizacji. Sprawdź podane dane.' },
        { status: 400 }
      );
    }
    if (!gmina) {
      return NextResponse.json({ error: 'Wybrana gmina nie istnieje.' }, { status: 400 });
    }
    data.gmina = { connect: { id: gminaId } };
  }
  if (street !== undefined) data.street = street;
  if (houseNumber !== undefined) data.houseNumber = houseNumber;
  if (apartmentNumber !== undefined) data.apartmentNumber = apartmentNumber;
  if (city !== undefined) data.city = city;
  if (postalCode !== undefined) data.postalCode = postalCode;
  if (contactFirstName !== undefined) data.contactFirstName = contactFirstName;
  if (contactLastName !== undefined) data.contactLastName = contactLastName;
  if (contactPhone !== undefined) data.contactPhone = contactPhone;
  if (contactEmail !== undefined) data.contactEmail = contactEmail || null;

  try {
    let movedUserIds: string[] = [];
    const organization = await prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({ where: { id: target.id }, data });
      // Every current member of this organization has their OWN gminaId set
      // to this organization's CURRENT gmina (enforced when each user was
      // created/edited — see POST/PATCH /api/admin/users). Moving the
      // organization is moving its members: cascade the same new gminaId
      // onto everyone whose organizationId still points here, in the same
      // transaction as the org's own write, so a concurrent POST/PATCH
      // /api/admin/users either lands entirely before this (old org gmina,
      // old membership) or entirely after (new gmina, sees the moved org) —
      // never a half-moved state where a user's gminaId disagrees with the
      // org it belongs to.
      if (isReassigningGmina) {
        const members = await tx.user.findMany({ where: { organizationId: target.id }, select: { id: true } });
        movedUserIds = members.map((m) => m.id);
        await tx.user.updateMany({ where: { organizationId: target.id }, data: { gminaId } });
      }
      return updated;
    });
    // Mirrors every other gminaId-mutating write site (see the doc comment on
    // invalidateUserStatusCache) — without this, each moved member's session
    // keeps scoping requests to their OLD gmina for up to the cache's 2-minute
    // TTL, silently, since the jwt() callback re-derives gminaId from this
    // Redis cache before ever falling back to Postgres.
    await Promise.all(movedUserIds.map((id) => invalidateUserStatusCache(id)));
    await recordAudit({
      actor: admin,
      action: 'ORGANIZATION_UPDATE',
      entityType: 'ORGANIZATION',
      entityId: organization.id,
      gminaId: organization.gminaId,
      before: snapshotOrganization(target),
      after: snapshotOrganization(organization),
      meta: requestMeta(req),
    });
    return NextResponse.json({ organization });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Organizacja o tej nazwie już istnieje w tej gminie.' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Nie udało się zaktualizować organizacji. Sprawdź podane dane.' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  let target;
  try {
    target = await prisma.organization.findUnique({ where: { id: params.id } });
  } catch {
    return NextResponse.json({ error: 'Nie udało się usunąć organizacji.' }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: 'Organizacja nie istnieje.' }, { status: 404 });
  }

  // Same own-gmina-only scope as PATCH.
  if (isGminaScopedAdmin(admin) && target.gminaId !== admin.gminaId) {
    return NextResponse.json({ error: 'Nie masz uprawnień do zarządzania tą organizacją.' }, { status: 403 });
  }

  try {
    await prisma.organization.delete({ where: { id: target.id } });
    await recordAudit({
      actor: admin,
      action: 'ORGANIZATION_DELETE',
      entityType: 'ORGANIZATION',
      entityId: target.id,
      gminaId: target.gminaId,
      before: snapshotOrganization(target),
      meta: requestMeta(req),
    });
  } catch (err) {
    // Every relation pointing at Organization is now RESTRICT (see the
    // schema.prisma comments on each): User.organizationId,
    // Resource.organizationId, ResourceAllocation.donorOrgId,
    // InviteToken.organization, and Alert.organization. P2003 doesn't say
    // which one fired, so the message can't claim a single specific cause —
    // that would actively mislead an admin who deletes an org with 0 users
    // but leftover resources/invites/alerts/allocations. This is the only
    // *expected* failure here; anything else is a real server error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json(
        {
          error:
            'Nie można usunąć tej organizacji, ponieważ istnieją powiązane rekordy (np. użytkownicy, zasoby, zaproszenia, alerty lub alokacje zasobów jako darczyńca).',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Nie udało się usunąć organizacji.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Organizacja została usunięta.' });
}
