import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateToken, hashToken, INVITE_TOKEN_TTL_MS } from '@/lib/tokens';
import { sendInviteEmail, isEmailConfigured } from '@/lib/email';
import { consumeLimit, inviteCreateLimiter } from '@/lib/rateLimit';
import { requireAdminOrCoordinator, isGlobalAdmin, isGminaScopedAdmin } from '@/lib/authz';
import { recordAudit, requestMeta, snapshotInvite } from '@/lib/auditLog';

export const runtime = 'nodejs';

/**
 * Reissues a revoked or expired (but not yet used) invite: a brand-new raw
 * token and expiry on the SAME InviteToken row, since the original raw token
 * was never stored (only its hash) and so can't simply be "un-revoked" back
 * into a usable link once it's gone — see the REVERTIBLE_ACTIONS comment in
 * lib/auditLog.ts. Mirrors POST /api/admin/invites' own create-and-email flow.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const allowed = await consumeLimit(inviteCreateLimiter, user.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Za dużo zaproszeń wysłanych w ostatnim czasie.' }, { status: 429 });
  }

  const invite = await prisma.inviteToken.findUnique({ where: { id: params.id } });
  if (!invite) {
    return NextResponse.json({ error: 'Zaproszenie nie istnieje.' }, { status: 404 });
  }

  // Same scoping as POST /api/admin/invites/[id]/revoke: global admin
  // unrestricted, gmina-scoped admin only their own gmina's invites,
  // COORDINATOR only the ones they sent.
  if (isGlobalAdmin(user)) {
    // unrestricted
  } else if (isGminaScopedAdmin(user)) {
    if (invite.gminaId !== user.gminaId) {
      return NextResponse.json({ error: 'Nie masz uprawnień do wznowienia tego zaproszenia.' }, { status: 403 });
    }
  } else if (invite.createdById !== user.id) {
    return NextResponse.json({ error: 'Nie masz uprawnień do wznowienia tego zaproszenia.' }, { status: 403 });
  }

  if (invite.usedAt) {
    return NextResponse.json({ error: 'Zaproszenie zostało już wykorzystane.' }, { status: 400 });
  }

  const isExpired = invite.expiresAt.getTime() < Date.now();
  if (!invite.revokedAt && !isExpired) {
    return NextResponse.json({ error: 'To zaproszenie jest już aktywne.' }, { status: 400 });
  }

  // Same check POST /api/admin/invites does before creating one — an
  // account for this email may have been created (or the invite accepted
  // through some other route) any time since this invite was revoked/expired.
  // Without it, reactivating just emails a token that /invite/[token]'s own
  // accept flow will dead-end on with "account already exists".
  const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existingUser) {
    return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
  }

  const rawToken = generateToken();
  let updated;
  try {
    updated = await prisma.inviteToken.update({
      where: { id: invite.id },
      data: {
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
        revokedAt: null,
      },
    });
  } catch (err) {
    console.error('[invites] failed to reactivate invite:', err);
    return NextResponse.json({ error: 'Nie udało się wznowić zaproszenia.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'INVITE_REACTIVATE',
    entityType: 'INVITE_TOKEN',
    entityId: invite.id,
    gminaId: invite.gminaId,
    before: snapshotInvite(invite),
    after: snapshotInvite(updated),
    meta: requestMeta(req),
  });

  const inviteUrl = `${process.env.NEXTAUTH_URL}/invite/${rawToken}`;
  await sendInviteEmail(invite.email, inviteUrl);

  return NextResponse.json({ message: 'Zaproszenie zostało wznowione.', inviteUrl, emailConfigured: isEmailConfigured });
}
