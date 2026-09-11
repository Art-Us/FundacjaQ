import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { createGmina } from '@/lib/gmina';

export const runtime = 'nodejs';

const gminaFieldsSchema = z.object({
  powiat: z.string().trim().max(120).nullable().optional(),
  voivodeship: z.string().trim().max(120).nullable().optional(),
  latitude: z.number().gte(-90).lte(90).nullable().optional(),
  longitude: z.number().gte(-180).lte(180).nullable().optional(),
});

const createGminaSchema = gminaFieldsSchema.extend({
  name: z.string().trim().min(1).max(120),
});

// Shared by the admin invites/users "+ Nowa gmina" inline create and the
// dedicated gmina management page — see createGmina() for the single place
// that decides whether a name is a duplicate.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = createGminaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { name, ...fields } = parsed.data;
  const result = await createGmina({ name, ...fields });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (!result.created) {
    return NextResponse.json({ error: 'Gmina o tej nazwie już istnieje.' }, { status: 409 });
  }

  return NextResponse.json({ gmina: result.gmina }, { status: 201 });
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const gminas = await prisma.gmina.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { users: true, resources: true, alerts: true, inviteTokens: true } },
    },
  });

  return NextResponse.json({ gminas });
}
