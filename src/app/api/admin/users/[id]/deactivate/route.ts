import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, canManageUser } from '@/lib/authz';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
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

  await prisma.user.update({
    where: { id: target.id },
    data: { isActive: false },
  });

  return NextResponse.json({ message: 'Konto zostało dezaktywowane.' });
}
