import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { hashPassword, isPasswordPwned, passwordSchema } from '@/lib/password';
import { adminUserSelect } from '@/lib/users';
import { requiresGmina, resolveGminaId } from '@/lib/gmina';
import { recordAudit, requestMeta, snapshotUser, auditInlineGminaCreation } from '@/lib/auditLog';

export const runtime = 'nodejs';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;

const createUserSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  role: z.enum(ROLES),
  gminaId: z.string().optional(),
  newGminaName: z.string().trim().min(1).max(120).optional(),
  name: z.string().optional(),
  organizationId: z.string().optional(),
  phone: z.string().optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: adminUserSelect,
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = createUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { email, password, role, gminaId, newGminaName, name, organizationId, phone } = parsed.data;

  let effectiveGminaId: string | undefined;
  if (requiresGmina(role) || gminaId || newGminaName) {
    const resolved = await resolveGminaId({ gminaId, newGminaName });
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    effectiveGminaId = resolved.id;
    await auditInlineGminaCreation(admin, resolved, requestMeta(req));
  }

  // Organization is itself gmina-scoped (see schema.prisma's @@unique([name,
  // gminaId]) comment) — an org from a different gmina than the one this
  // user ends up in would silently break that scoping for every view that
  // joins a user through their organization, so it's checked here alongside
  // plain existence, not just left to the FK (which only guards existence).
  if (organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, gminaId: true },
    });
    if (!organization) {
      return NextResponse.json({ error: 'Wybrana organizacja nie istnieje.' }, { status: 400 });
    }
    if (effectiveGminaId && organization.gminaId !== effectiveGminaId) {
      return NextResponse.json(
        { error: 'Wybrana organizacja należy do innej gminy niż użytkownik.' },
        { status: 400 }
      );
    }
  }

  if (await isPasswordPwned(password)) {
    return NextResponse.json(
      { error: 'To hasło znajduje się w publicznych bazach wycieków. Wybierz inne.' },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  try {
    // isActive: false — an admin-created account still needs an explicit
    // activation step, same as one created through the invite flow.
    const user = await prisma.user.create({
      data: { email, passwordHash, role, gminaId: effectiveGminaId, name, organizationId, phone, isActive: false },
      select: adminUserSelect,
    });
    await recordAudit({
      actor: admin,
      action: 'USER_CREATE',
      entityType: 'USER',
      entityId: user.id,
      gminaId: user.gminaId,
      after: snapshotUser(user),
      meta: requestMeta(req),
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    // The `existing` email check above already covers the common case — this
    // only fires on a genuine race (two concurrent creates for the same
    // email), a real P2002 unique-constraint hit. Anything else is a real
    // server error, not "this email is already registered".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Konto dla tego adresu email już istnieje.' }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Nie udało się utworzyć użytkownika. Sprawdź podane dane (np. gminę lub organizację).' },
      { status: 400 }
    );
  }
}
