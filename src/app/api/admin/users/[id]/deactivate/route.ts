import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, canManageUser, isLastActiveAdmin } from '@/lib/authz';
import { recordAudit, requestMeta, snapshotUser } from '@/lib/auditLog';
import { invalidateUserStatusCache } from '@/lib/userStatusCache';

export const runtime = 'nodejs';

const deactivateSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) {
    return NextResponse.json({ error: 'Użytkownik nie istnieje.' }, { status: 404 });
  }

  if (!canManageUser(user, target)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do zarządzania tym użytkownikiem.' }, { status: 403 });
  }

  if (!target.isActive) {
    return NextResponse.json({ message: 'Konto jest już nieaktywne.' });
  }

  if (await isLastActiveAdmin(target)) {
    return NextResponse.json(
      { error: 'Nie można dezaktywować jedynego aktywnego administratora w systemie.' },
      { status: 403 }
    );
  }

  const parsed = deactivateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: target.id },
      data: { isActive: false, lastDeactivatedAt: new Date(), deactivationReason: parsed.data.reason ?? null },
    });
  } catch (err) {
    console.error('[users] failed to deactivate user:', err);
    return NextResponse.json({ error: 'Nie udało się dezaktywować konta.' }, { status: 500 });
  }

  await invalidateUserStatusCache(target.id);

  await recordAudit({
    actor: user,
    action: 'USER_DEACTIVATE',
    entityType: 'USER',
    entityId: target.id,
    gminaId: updated.gminaId,
    before: snapshotUser(target),
    after: snapshotUser(updated),
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Konto zostało dezaktywowane.' });
}
