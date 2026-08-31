import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const invite = await prisma.inviteToken.findUnique({ where: { id: params.id } });
  if (!invite) {
    return NextResponse.json({ error: 'Zaproszenie nie istnieje.' }, { status: 404 });
  }

  // ADMIN can revoke any invite; COORDINATOR only the ones they sent.
  if (user.role !== 'ADMIN' && invite.createdById !== user.id) {
    return NextResponse.json({ error: 'Nie masz uprawnień do unieważnienia tego zaproszenia.' }, { status: 403 });
  }

  if (invite.usedAt) {
    return NextResponse.json({ error: 'Zaproszenie zostało już wykorzystane.' }, { status: 400 });
  }

  if (invite.revokedAt) {
    return NextResponse.json({ message: 'Zaproszenie jest już unieważnione.' });
  }

  await prisma.inviteToken.update({
    where: { id: invite.id },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ message: 'Zaproszenie zostało unieważnione.' });
}