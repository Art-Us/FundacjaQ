import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { normalizeOrganizationName } from '@/lib/organization';
import { recordAudit, requestMeta, snapshotOrganization } from '@/lib/auditLog';

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
    // Every current user of this organization has their OWN gminaId set to
    // this organization's CURRENT gmina (enforced when each user was
    // created/edited — see POST/PATCH /api/admin/users). Reassigning the
    // organization to a different gmina here would silently break that
    // invariant for every one of them without touching their own records,
    // so it's blocked the same way deleting a dependent-having record
    // already is elsewhere in this codebase, rather than left to corrupt
    // silently.
    const usersCount = await prisma.user.count({ where: { organizationId: target.id } });
    if (usersCount > 0) {
      return NextResponse.json(
        {
          error:
            'Nie można zmienić gminy tej organizacji, ponieważ są z nią powiązani użytkownicy przypisani do poprzedniej gminy.',
        },
        { status: 409 }
      );
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
    const organization = await prisma.$transaction(async (tx) => {
      // Re-check right before the write: a concurrent POST/PATCH
      // /api/admin/users could have assigned a user to this organization in
      // the time since the usersCount check above (e.g. while this request
      // was still validating the new gmina/name). Doesn't eliminate the race
      // (no lock is held), but closes all but a same-transaction-sized
      // window, matching the same accepted-risk posture as
      // isLastActiveAdmin's count-then-act check.
      if (isReassigningGmina) {
        const usersCount = await tx.user.count({ where: { organizationId: target.id } });
        if (usersCount > 0) {
          throw new TransactionAbort(
            409,
            'Nie można zmienić gminy tej organizacji, ponieważ są z nią powiązani użytkownicy przypisani do poprzedniej gminy.'
          );
        }
      }
      return tx.organization.update({ where: { id: target.id }, data });
    });
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
    if (err instanceof TransactionAbort) {
      return NextResponse.json({ error: err.error }, { status: err.status });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Organizacja o tej nazwie już istnieje w tej gminie.' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Nie udało się zaktualizować organizacji. Sprawdź podane dane.' },
      { status: 400 }
    );
  }
}

/** Thrown from inside a $transaction callback to abort+rollback it while carrying a typed HTTP response back out. */
class TransactionAbort extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string
  ) {
    super(error);
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
    // User.organizationId is ON DELETE RESTRICT (deliberately, unlike
    // User.gminaId — see the schema.prisma comment), so an organization with
    // any users still assigned fails with P2003 — the only *expected*
    // failure here; anything else is a real server error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json(
        { error: 'Nie można usunąć tej organizacji, ponieważ są z nią powiązani użytkownicy.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Nie udało się usunąć organizacji.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Organizacja została usunięta.' });
}
