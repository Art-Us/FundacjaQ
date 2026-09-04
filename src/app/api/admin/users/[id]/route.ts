import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { adminUserSelect } from '@/lib/users';

export const runtime = 'nodejs';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

const updateUserSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES).optional(),
  gminaId: z.string().nullable().optional(),
  organization: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  // Only meaningful when isActive is being set to false in the same request
  // — see the isActive handling below.
  deactivationReason: z.string().trim().min(1).max(500).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id: params.id }, select: adminUserSelect });
  if (!user) {
    return NextResponse.json({ error: 'Użytkownik nie istnieje.' }, { status: 404 });
  }

  return NextResponse.json({ user });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'Użytkownik nie istnieje.' }, { status: 404 });
  }

  const parsed = updateUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  // isActive is re-checked live on every session refresh (src/lib/auth.ts jwt
  // callback) — self-deactivation would kill the admin's own session mid-request.
  if (target.id === admin.id && parsed.data.isActive === false) {
    return NextResponse.json({ error: 'Nie możesz dezaktywować własnego konta.' }, { status: 403 });
  }

  if (parsed.data.email && parsed.data.email !== target.email) {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
    }
  }

  const { deactivationReason, ...rest } = parsed.data;
  const data: Prisma.UserUpdateInput = { ...rest };
  if (parsed.data.isActive === true) {
    data.lastActivatedAt = new Date();
  } else if (parsed.data.isActive === false) {
    data.lastDeactivatedAt = new Date();
    data.deactivationReason = deactivationReason ?? null;
  }

  try {
    const user = await prisma.user.update({
      where: { id: target.id },
      data,
      select: adminUserSelect,
    });
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json(
      { error: 'Nie udało się zaktualizować użytkownika. Sprawdź podane dane (np. gminę).' },
      { status: 400 }
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  if (params.id === admin.id) {
    return NextResponse.json({ error: 'Nie możesz usunąć własnego konta.' }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'Użytkownik nie istnieje.' }, { status: 404 });
  }

  try {
    await prisma.user.delete({ where: { id: target.id } });
  } catch {
    // InviteToken.createdById and PasswordResetToken.userId are ON DELETE
    // RESTRICT, so a user with either kind of history can't be hard-deleted.
    return NextResponse.json(
      {
        error:
          'Nie można usunąć tego użytkownika, ponieważ istnieją powiązane rekordy (np. zaproszenia). Zamiast tego dezaktywuj konto.',
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ message: 'Użytkownik został usunięty.' });
}
