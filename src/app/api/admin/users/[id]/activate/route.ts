import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, canManageUser } from '@/lib/authz';
import { recordAudit, requestMeta, snapshotUser } from '@/lib/auditLog';
import { invalidateUserStatusCache } from '@/lib/userStatusCache';

export const runtime = 'nodejs';

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

  if (target.isActive) {
    return NextResponse.json({ message: 'Konto jest już aktywne.' });
  }

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: target.id },
      data: { isActive: true, lastActivatedAt: new Date() },
    });
  } catch (err) {
    console.error('[users] failed to activate user:', err);
    return NextResponse.json({ error: 'Nie udało się aktywować konta.' }, { status: 500 });
  }

  await invalidateUserStatusCache(target.id);

  await recordAudit({
    actor: user,
    action: 'USER_ACTIVATE',
    entityType: 'USER',
    entityId: target.id,
    gminaId: updated.gminaId,
    before: snapshotUser(target),
    after: snapshotUser(updated),
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Konto zostało aktywowane.' });
}
