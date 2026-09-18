import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrCoordinator, canManageUser } from '@/lib/authz';
import { hashPassword, isPasswordPwned, passwordSchema } from '@/lib/password';
import { adminUserSelect, ROLE_LABELS } from '@/lib/users';
import { requiresGmina, resolveGminaId } from '@/lib/gmina';
import { requiresOrganization, scopedOrganizationWhere } from '@/lib/organization';
import { recordAudit, requestMeta, snapshotUser, auditInlineGminaCreation } from '@/lib/auditLog';
import { escapeLikePattern } from '@/lib/utils';

export const runtime = 'nodejs';

const ROLES = ['ADMIN', 'COORDINATOR', 'VOLUNTEER'] as const;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const SORT_FIELDS = ['createdAt', 'lastActivatedAt', 'lastDeactivatedAt', 'name'] as const;
const SORT_DIRS = ['asc', 'desc'] as const;
type SortField = (typeof SORT_FIELDS)[number];
type SortDir = (typeof SORT_DIRS)[number];

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

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(1_000_000).optional().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
  q: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  role: z.enum(ROLES).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  onlyPending: z.enum(['true', 'false']).optional(),
  gminaId: z.string().optional(),
  organizationId: z.string().optional(),
  sortBy: z.enum(SORT_FIELDS).optional().default('createdAt'),
  sortDir: z.enum(SORT_DIRS).optional().default('desc'),
});

/**
 * `id` as a stable tiebreaker: two rows sharing the same sort value (e.g. two
 * users created in the same millisecond, or two with no lastActivatedAt)
 * would otherwise have no guaranteed relative order across pages — a row
 * could be skipped or repeated when paginating. Direction-independent of the
 * primary sort; it only needs to be consistent, not meaningful.
 */
function buildOrderBy(sortBy: SortField, sortDir: SortDir): Prisma.UserOrderByWithRelationInput[] {
  const primary: Prisma.UserOrderByWithRelationInput =
    sortBy === 'name'
      ? { name: sortDir }
      : sortBy === 'lastActivatedAt'
        ? { lastActivatedAt: sortDir }
        : sortBy === 'lastDeactivatedAt'
          ? { lastDeactivatedAt: sortDir }
          : { createdAt: sortDir };
  return [primary, { id: 'asc' }];
}

/**
 * Free-text search across the same fields the (now server-side) search used
 * to check client-side: name/email/phone/deactivation reason as substring
 * matches, plus organization/gmina name through their relations, plus a
 * "does the query match this role/status's displayed LABEL" check — so
 * typing "administrator" or "nieaktywny" still works, not just raw column
 * values a user would never type.
 */
function buildSearchOr(q: string): Prisma.UserWhereInput[] {
  const escaped = escapeLikePattern(q);
  const lower = q.toLowerCase();
  const conditions: Prisma.UserWhereInput[] = [
    { name: { contains: escaped, mode: 'insensitive' } },
    { email: { contains: escaped, mode: 'insensitive' } },
    { phone: { contains: escaped, mode: 'insensitive' } },
    { deactivationReason: { contains: escaped, mode: 'insensitive' } },
    { organization: { name: { contains: escaped, mode: 'insensitive' } } },
    { gmina: { name: { contains: escaped, mode: 'insensitive' } } },
  ];
  const matchingRoles = (Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).filter((r) =>
    ROLE_LABELS[r].toLowerCase().includes(lower)
  );
  if (matchingRoles.length > 0) conditions.push({ role: { in: matchingRoles } });
  if ('aktywny'.includes(lower)) conditions.push({ isActive: true });
  if ('nieaktywny'.includes(lower)) conditions.push({ isActive: false });
  return conditions;
}

export async function GET(req: NextRequest) {
  const actor = await requireAdminOrCoordinator();
  if (!actor) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe parametry filtrowania.' }, { status: 400 });
  }
  const { page, pageSize, q, role, status, onlyPending, gminaId, organizationId, sortBy, sortDir } = parsed.data;

  // COORDINATOR visibility is now scoped by organization, not gmina: ADMIN
  // sees everything ({}), a coordinator sees only their own organization's
  // users, and a coordinator with NO organization of their own sees nothing
  // — never silently falls back to "no restriction" (same fail-closed
  // contract scopedGminaWhere used to provide here; see the 2026-09-10 audit
  // finding this exact fail-open pattern already caused an IDOR elsewhere).
  const scopeFilter = scopedOrganizationWhere(actor);
  if (scopeFilter === null) {
    return NextResponse.json({ users: [], total: 0, page, pageSize, totalPages: 0 });
  }

  const where: Prisma.UserWhereInput = {
    ...scopeFilter,
    ...(role ? { role } : {}),
    ...(status === 'ACTIVE' ? { isActive: true } : {}),
    ...(status === 'INACTIVE' ? { isActive: false } : {}),
    ...(onlyPending === 'true' ? { lastActivatedAt: null } : {}),
    // Only ADMIN's explicit gminaId/organizationId query params are honored
    // here, spread AFTER ...scopeFilter so they can only ever narrow an
    // ADMIN's unrestricted `{}` — never applied for a COORDINATOR, since
    // either key would otherwise silently overwrite (and widen) their own
    // fail-closed organization scope above.
    ...(actor.role === 'ADMIN' && gminaId ? { gminaId } : {}),
    ...(actor.role === 'ADMIN' && organizationId ? { organizationId } : {}),
    ...(q ? { OR: buildSearchOr(q) } : {}),
  };

  try {
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: buildOrderBy(sortBy, sortDir),
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { ...adminUserSelect, gmina: { select: { id: true, name: true } } },
      }),
    ]);

    return NextResponse.json({
      users: users.map((user) => ({
        ...user,
        isSelf: user.id === actor.id,
        canManage: canManageUser(actor, user),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać listy użytkowników.' }, { status: 500 });
  }
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
  // Unconditional (not just "when effectiveGminaId is set"): an org can never
  // be assigned to a user with no gmina at all either, otherwise that mismatch
  // becomes permanent — PATCH /api/admin/users/[id]'s equivalent check has no
  // such carve-out, so any later edit that doesn't explicitly clear
  // organizationId would be stuck rejecting forever.
  if (requiresOrganization(role) && !organizationId) {
    return NextResponse.json({ error: 'Organizacja jest wymagana dla tej roli.' }, { status: 400 });
  }

  if (organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
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
    const user = await prisma.$transaction(async (tx) => {
      // Re-check the organization's gmina one more time, right before the
      // write: the precheck above ran before an external HTTP call
      // (isPasswordPwned) and an email-uniqueness lookup, both of which
      // widen the window for a concurrent PATCH /api/admin/organizations/[id]
      // to reassign this organization to a different gmina in between. This
      // doesn't eliminate the race (no lock is held), but it closes all but
      // a same-transaction-sized window, matching the same accepted-risk
      // posture as isLastActiveAdmin's count-then-act check.
      if (organizationId) {
        const organization = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { gminaId: true },
        });
        if (!organization || organization.gminaId !== effectiveGminaId) {
          throw new TransactionAbort(
            409,
            'Wybrana organizacja zmieniła gminę w trakcie tworzenia użytkownika — spróbuj ponownie.'
          );
        }
      }

      // isActive: false — an admin-created account still needs an explicit
      // activation step, same as one created through the invite flow.
      return tx.user.create({
        data: { email, passwordHash, role, gminaId: effectiveGminaId, name, organizationId, phone, isActive: false },
        select: adminUserSelect,
      });
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
    if (err instanceof TransactionAbort) {
      return NextResponse.json({ error: err.error }, { status: err.status });
    }
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

/** Thrown from inside a $transaction callback to abort+rollback it while carrying a typed HTTP response back out. */
class TransactionAbort extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string
  ) {
    super(error);
  }
}
