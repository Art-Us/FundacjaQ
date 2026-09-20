import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, isLastActiveAdmin, wouldLoseActiveAdminStatus } from '@/lib/authz';
import { adminUserSelect } from '@/lib/users';
import { requiresGmina, resolveGminaId } from '@/lib/gmina';
import { recordAudit, requestMeta, snapshotUser, auditInlineGminaCreation } from '@/lib/auditLog';
import { invalidateUserStatusCache } from '@/lib/userStatusCache';

export const runtime = 'nodejs';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

const updateUserSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES).optional(),
  gminaId: z.string().nullable().optional(),
  newGminaName: z.string().trim().min(1).max(120).optional(),
  organizationId: z.string().nullable().optional(),
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

  // Resolved once, up front: what role/isActive this user will end up with
  // after this PATCH, whether or not this request actually touches those
  // fields. Needed both for the last-admin guard below (which must catch a
  // role change away from ADMIN just as much as isActive:false — either one
  // strips "active admin" status) and for requiresGmina() further down.
  const nextRole = parsed.data.role ?? target.role;
  const nextIsActive = parsed.data.isActive ?? target.isActive;

  if (wouldLoseActiveAdminStatus(target, { role: nextRole, isActive: nextIsActive }) && (await isLastActiveAdmin(target))) {
    return NextResponse.json(
      { error: 'Nie można dezaktywować jedynego aktywnego administratora w systemie.' },
      { status: 403 }
    );
  }

  if (parsed.data.email && parsed.data.email !== target.email) {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
    }
  }

  const { deactivationReason, newGminaName, ...rest } = parsed.data;
  const data: Prisma.UserUncheckedUpdateInput = { ...rest };

  // What gminaId will this user end up with after this update, resolving
  // newGminaName same as below but computed first so we can validate it.
  let effectiveGminaId = parsed.data.gminaId !== undefined ? parsed.data.gminaId : target.gminaId;

  if (newGminaName) {
    const resolved = await resolveGminaId({ newGminaName });
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    effectiveGminaId = resolved.id;
    data.gminaId = resolved.id;
    await auditInlineGminaCreation(admin, resolved, requestMeta(req));
  }

  // Every non-ADMIN must belong to a gmina — enforced at creation time via
  // requiresGmina() (see /api/admin/users and invite acceptance), but an
  // update could otherwise silently detach a COORDINATOR/VOLUNTEER from
  // their gmina (explicit gminaId: null, or a role change with no gminaId
  // in the same request). That broke gmina-scoped visibility for the
  // affected user elsewhere (see scopedGminaWhere in lib/gmina.ts).
  if (requiresGmina(nextRole) && !effectiveGminaId) {
    return NextResponse.json({ error: 'Ta rola wymaga przypisanej gminy.' }, { status: 400 });
  }

  // Same gmina-match check as POST /api/admin/users, plus one POST doesn't
  // need: if this update changes gminaId/role but leaves organizationId
  // untouched, the user's PRE-EXISTING organization can now mismatch the
  // gmina they end up in — so this checks the resulting (effective)
  // organization, not just a freshly-submitted one.
  const effectiveOrganizationId =
    parsed.data.organizationId !== undefined ? parsed.data.organizationId : target.organizationId;
  if (effectiveOrganizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: effectiveOrganizationId },
      select: { id: true, gminaId: true },
    });
    if (!organization) {
      return NextResponse.json({ error: 'Wybrana organizacja nie istnieje.' }, { status: 400 });
    }
    if (organization.gminaId !== effectiveGminaId) {
      return NextResponse.json(
        { error: 'Wybrana organizacja należy do innej gminy niż użytkownik.' },
        { status: 400 }
      );
    }
  }

  if (parsed.data.isActive === true) {
    data.lastActivatedAt = new Date();
  } else if (parsed.data.isActive === false) {
    data.lastDeactivatedAt = new Date();
    data.deactivationReason = deactivationReason ?? null;
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      // Re-check the organization's gmina one more time, right before the
      // write: the precheck above ran before the email-collision lookup,
      // widening the window for a concurrent PATCH
      // /api/admin/organizations/[id] to reassign this organization to a
      // different gmina in between. Doesn't eliminate the race (no lock is
      // held), but closes all but a same-transaction-sized window.
      if (effectiveOrganizationId) {
        const organization = await tx.organization.findUnique({
          where: { id: effectiveOrganizationId },
          select: { gminaId: true },
        });
        if (!organization || organization.gminaId !== effectiveGminaId) {
          throw new TransactionAbort(
            409,
            'Wybrana organizacja zmieniła gminę w trakcie aktualizacji użytkownika — spróbuj ponownie.'
          );
        }
      }
      return tx.user.update({
        where: { id: target.id },
        data,
        select: adminUserSelect,
      });
    });
    await invalidateUserStatusCache(user.id);
    await recordAudit({
      actor: admin,
      action: 'USER_UPDATE',
      entityType: 'USER',
      entityId: user.id,
      gminaId: user.gminaId,
      before: snapshotUser(target),
      after: snapshotUser(user),
      meta: requestMeta(req),
    });
    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof TransactionAbort) {
      return NextResponse.json({ error: err.error }, { status: err.status });
    }
    // The email-collision check above already covers the common case — this
    // only fires on a genuine race (two concurrent updates to the same new
    // email), a real P2002 unique-constraint hit. Anything else is a real
    // server error, not "this email is already registered".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Nie udało się zaktualizować użytkownika. Sprawdź podane dane (np. gminę lub organizację).' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
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

  if (await isLastActiveAdmin(target)) {
    return NextResponse.json(
      { error: 'Nie można usunąć jedynego aktywnego administratora w systemie.' },
      { status: 403 }
    );
  }

  try {
    await prisma.user.delete({ where: { id: target.id } });
    await invalidateUserStatusCache(target.id);
    await recordAudit({
      actor: admin,
      action: 'USER_DELETE',
      entityType: 'USER',
      entityId: target.id,
      gminaId: target.gminaId,
      before: snapshotUser(target),
      meta: requestMeta(req),
    });
  } catch (err) {
    // InviteToken.createdById and PasswordResetToken.userId are ON DELETE
    // RESTRICT, so a user with either kind of history fails with P2003 —
    // that's the only *expected* failure here; anything else is a real
    // server error, not "has related records".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json(
        {
          error:
            'Nie można usunąć tego użytkownika, ponieważ istnieją powiązane rekordy (np. zaproszenia). Zamiast tego dezaktywuj konto.',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Nie udało się usunąć użytkownika.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Użytkownik został usunięty.' });
}

/** Thrown from inside a $transaction callback to abort+rollback it while carrying a typed HTTP response back out. */
class TransactionAbort extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string
  ) {
    super(error);
  }
}
