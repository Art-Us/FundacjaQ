import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isGlobalAdmin, isGminaScopedAdmin } from '@/lib/authz';
import { recordAudit, requestMeta, snapshotInvite } from '@/lib/auditLog';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const invite = await prisma.inviteToken.findUnique({ where: { id: params.id } });
  if (!invite) {
    return NextResponse.json({ error: 'Zaproszenie nie istnieje.' }, { status: 404 });
  }

  // A global admin can revoke any invite; a gmina-scoped admin only one
  // belonging to their own gmina (this route used to check `user.role !==
  // 'ADMIN'`, which treated every ADMIN as unconditionally unrestricted —
  // the exact gap gmina-scoped ADMIN was introduced to close everywhere
  // else); a COORDINATOR only the ones they sent themselves.
  if (isGlobalAdmin(user)) {
    // unrestricted
  } else if (isGminaScopedAdmin(user)) {
    if (invite.gminaId !== user.gminaId) {
      return NextResponse.json({ error: 'Nie masz uprawnień do unieważnienia tego zaproszenia.' }, { status: 403 });
    }
  } else if (invite.createdById !== user.id) {
    return NextResponse.json({ error: 'Nie masz uprawnień do unieważnienia tego zaproszenia.' }, { status: 403 });
  }

  if (invite.usedAt) {
    return NextResponse.json({ error: 'Zaproszenie zostało już wykorzystane.' }, { status: 400 });
  }

  if (invite.revokedAt) {
    return NextResponse.json({ message: 'Zaproszenie jest już unieważnione.' });
  }

  let updated;
  try {
    updated = await prisma.inviteToken.update({
      where: { id: invite.id },
      data: { revokedAt: new Date() },
    });
  } catch (err) {
    console.error('[invites] failed to revoke invite:', err);
    return NextResponse.json({ error: 'Nie udało się unieważnić zaproszenia.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'INVITE_REVOKE',
    entityType: 'INVITE_TOKEN',
    entityId: invite.id,
    gminaId: invite.gminaId,
    before: snapshotInvite(invite),
    after: snapshotInvite(updated),
    meta: requestMeta(req),
  });

  return NextResponse.json({ message: 'Zaproszenie zostało unieważnione.' });
}