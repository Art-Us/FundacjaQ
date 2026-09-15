import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { normalizeGminaName } from '@/lib/gmina';
import { recordAudit, requestMeta, snapshotGmina } from '@/lib/auditLog';

export const runtime = 'nodejs';

const updateGminaSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  powiat: z.string().trim().max(120).nullable().optional(),
  voivodeship: z.string().trim().max(120).nullable().optional(),
  latitude: z.number().gte(-90).lte(90).nullable().optional(),
  longitude: z.number().gte(-180).lte(180).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const target = await prisma.gmina.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'Gmina nie istnieje.' }, { status: 404 });
  }

  const parsed = updateGminaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { name, powiat, voivodeship, latitude, longitude } = parsed.data;
  const data: Prisma.GminaUpdateInput = {};

  if (name !== undefined) {
    const normalized = normalizeGminaName(name);
    if (!normalized) {
      return NextResponse.json({ error: 'Nazwa gminy jest wymagana.' }, { status: 400 });
    }
    if (normalized.toLowerCase() !== target.name.toLowerCase()) {
      let existing;
      try {
        existing = await prisma.gmina.findFirst({ where: { name: { equals: normalized, mode: 'insensitive' } } });
      } catch {
        return NextResponse.json(
          { error: 'Nie udało się zaktualizować gminy. Sprawdź podane dane.' },
          { status: 400 }
        );
      }
      if (existing && existing.id !== target.id) {
        return NextResponse.json({ error: 'Gmina o tej nazwie już istnieje.' }, { status: 409 });
      }
    }
    data.name = normalized;
  }
  if (powiat !== undefined) data.powiat = powiat;
  if (voivodeship !== undefined) data.voivodeship = voivodeship;
  if (latitude !== undefined) data.latitude = latitude;
  if (longitude !== undefined) data.longitude = longitude;

  try {
    const gmina = await prisma.gmina.update({ where: { id: target.id }, data });
    await recordAudit({
      actor: admin,
      action: 'GMINA_UPDATE',
      entityType: 'GMINA',
      entityId: gmina.id,
      gminaId: gmina.id,
      before: snapshotGmina(target),
      after: snapshotGmina(gmina),
      meta: requestMeta(req),
    });
    return NextResponse.json({ gmina });
  } catch (err) {
    // Two concurrent renames can both pass the pre-check above — the unique
    // index on `name` is case-sensitive, so only an exact-name race lands
    // here (same limitation as createGmina's own P2002 handling).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Gmina o tej nazwie już istnieje.' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Nie udało się zaktualizować gminy. Sprawdź podane dane.' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const target = await prisma.gmina.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'Gmina nie istnieje.' }, { status: 404 });
  }

  try {
    await prisma.gmina.delete({ where: { id: target.id } });
    await recordAudit({
      actor: admin,
      action: 'GMINA_DELETE',
      entityType: 'GMINA',
      entityId: target.id,
      gminaId: target.id,
      before: snapshotGmina(target),
      meta: requestMeta(req),
    });
  } catch (err) {
    // User/Resource/Alert/InviteToken.gminaId are ON DELETE RESTRICT, so a
    // gmina with any dependents fails with P2003 — that's the only *expected*
    // failure here; anything else is a real server error, not "has dependents".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json(
        {
          error:
            'Nie można usunąć tej gminy, ponieważ są z nią powiązani użytkownicy, zasoby, alerty, zaproszenia lub organizacje.',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Nie udało się usunąć gminy.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Gmina została usunięta.' });
}
