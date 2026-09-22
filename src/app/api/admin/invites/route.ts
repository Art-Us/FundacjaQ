import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateToken, hashToken, INVITE_TOKEN_TTL_MS } from '@/lib/tokens';
import { sendInviteEmail, isEmailConfigured } from '@/lib/email';
import { consumeLimit, inviteCreateLimiter } from '@/lib/rateLimit';
import { requireAdminOrCoordinator, isGlobalAdmin, isGminaScopedAdmin, scopedAdminManagementWhere } from '@/lib/authz';
import { requiresGmina, resolveGminaId } from '@/lib/gmina';
import { requiresOrganization } from '@/lib/organization';
import { recordAudit, requestMeta, snapshotInvite, auditInlineGminaCreation } from '@/lib/auditLog';

export const runtime = 'nodejs';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
  gminaId: z.string().optional(),
  newGminaName: z.string().trim().min(1).max(120).optional(),
  organizationId: z.string().optional(),
});

export async function GET() {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  // Same fail-closed scoping as GET /api/admin/users — a global admin sees
  // everything, a gmina-scoped admin sees their whole gmina's invites, a
  // coordinator only invites tied to their own organization, and anyone
  // scoped with nothing of their own sees none at all. Invites created
  // before organizationId existed on this model have it unset, so they
  // simply won't appear in a coordinator's scoped view going forward.
  const scopeFilter = scopedAdminManagementWhere(user);
  if (scopeFilter === null) {
    return NextResponse.json({ invites: [] });
  }

  const invites = await prisma.inviteToken.findMany({
    where: scopeFilter,
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ invites });
}

export async function POST(req: NextRequest) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const allowed = await consumeLimit(inviteCreateLimiter, user.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Za dużo zaproszeń wysłanych w ostatnim czasie.' }, { status: 429 });
  }

  const parsed = createInviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { email, role, gminaId, newGminaName, organizationId } = parsed.data;

  // Only a *global* admin can grant ADMIN — a gmina-scoped admin has every
  // other ADMIN capability within their own gmina, but never the power to
  // create more admins (global or gmina-scoped, anywhere). Any ADMIN
  // (global or gmina-scoped) can still grant COORDINATOR, unchanged.
  if (role === 'ADMIN' && !isGlobalAdmin(user)) {
    return NextResponse.json({ error: 'Tylko globalny administrator może nadać rolę administratora.' }, { status: 403 });
  }
  if (role === 'COORDINATOR' && user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Nie masz uprawnień do przypisania tej roli.' }, { status: 403 });
  }

  // The "+ Nowa gmina" inline flow creates a real Gmina row right here,
  // which would otherwise be invisible to the audit log.
  async function resolveAndAuditGmina(): Promise<{ id: string } | { error: string }> {
    const resolved = await resolveGminaId({ gminaId, newGminaName });
    if ('error' in resolved) return resolved;
    await auditInlineGminaCreation(user!, resolved, requestMeta(req));
    return { id: resolved.id };
  }

  // A coordinator can never pick or create a gmina/organization — the invite
  // always goes to their own organization, regardless of what the request
  // body claims. A coordinator with no organization of their own can't
  // invite anyone at all (mirrors scopedOrganizationWhere's fail-closed
  // contract for user-list visibility and canManageUser's for
  // activate/deactivate — all three now gate on organization, not gmina).
  let effectiveGminaId: string | undefined;
  let effectiveOrganizationId: string | undefined;
  if (user.role === 'COORDINATOR') {
    if (!user.organizationId) {
      return NextResponse.json(
        { error: 'Nie masz przypisanej organizacji — nie możesz zapraszać użytkowników.' },
        { status: 400 }
      );
    }
    const organization = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { id: true, gminaId: true },
    });
    if (!organization) {
      return NextResponse.json(
        { error: 'Twoja organizacja już nie istnieje — skontaktuj się z administratorem.' },
        { status: 400 }
      );
    }
    effectiveOrganizationId = organization.id;
    // The organization's own gmina, not necessarily the coordinator's
    // gminaId field — an organization is the source of truth for which
    // gmina its members belong to (see the org/gmina match checks in
    // POST/PATCH /api/admin/users).
    effectiveGminaId = organization.gminaId;
  } else if (isGminaScopedAdmin(user)) {
    // Same "can never leave their own scope" contract as the COORDINATOR
    // branch above, adapted for a gmina-scoped admin: no inline "+ Nowa
    // gmina" (a brand-new gmina is by definition outside their own scope —
    // only a global admin may create one), and no targeting a different
    // gmina than their own, even if the request body claims one.
    if (newGminaName) {
      return NextResponse.json({ error: 'Tylko globalny administrator może utworzyć nową gminę.' }, { status: 403 });
    }
    if (gminaId && gminaId !== user.gminaId) {
      return NextResponse.json({ error: 'Możesz zapraszać tylko w obrębie własnej gminy.' }, { status: 403 });
    }
    effectiveGminaId = user.gminaId ?? undefined;
  } else if (requiresGmina(role) || gminaId || newGminaName) {
    const resolved = await resolveAndAuditGmina();
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    effectiveGminaId = resolved.id;
  }

  // Mirrors POST /api/admin/users: an admin-issued invite to an
  // organization-scoped role must name the organization up front now,
  // instead of leaving it to be assigned later. Validated the same way as
  // there — must exist, and must belong to the same gmina the invite is
  // going to (an organization is itself gmina-scoped).
  if (user.role === 'ADMIN' && requiresOrganization(role)) {
    if (!organizationId) {
      return NextResponse.json({ error: 'Organizacja jest wymagana dla tej roli.' }, { status: 400 });
    }
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, gminaId: true },
    });
    if (!organization) {
      return NextResponse.json({ error: 'Wybrana organizacja nie istnieje.' }, { status: 400 });
    }
    if (organization.gminaId !== effectiveGminaId) {
      return NextResponse.json(
        { error: 'Wybrana organizacja należy do innej gminy niż zaproszenie.' },
        { status: 400 }
      );
    }
    effectiveOrganizationId = organization.id;
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
  }

  const rawToken = generateToken();
  let invite;
  try {
    invite = await prisma.inviteToken.create({
      data: {
        email,
        role,
        gminaId: effectiveGminaId,
        organizationId: effectiveOrganizationId,
        tokenHash: hashToken(rawToken),
        createdById: user.id,
        expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
      },
    });
  } catch (err) {
    console.error('[invites] failed to create invite token:', err);
    return NextResponse.json({ error: 'Nie udało się utworzyć zaproszenia.' }, { status: 500 });
  }

  await recordAudit({
    actor: user,
    action: 'INVITE_CREATE',
    entityType: 'INVITE_TOKEN',
    entityId: invite.id,
    gminaId: invite.gminaId,
    after: snapshotInvite(invite),
    meta: requestMeta(req),
  });

  const inviteUrl = `${process.env.NEXTAUTH_URL}/invite/${rawToken}`;
  await sendInviteEmail(email, inviteUrl);

  return NextResponse.json({ message: 'Zaproszenie wysłane.', inviteUrl, emailConfigured: isEmailConfigured });
}
