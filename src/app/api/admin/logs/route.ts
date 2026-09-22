import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuditEntityType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, isGminaScopedAdmin } from '@/lib/authz';
import { canRevert, ACTION_KINDS, ACTION_KIND_MAP } from '@/lib/auditLog';
import { escapeLikePattern } from '@/lib/utils';

export const runtime = 'nodejs';

const MAX_TAKE = 100;
const DEFAULT_TAKE = 50;

// Logs (and reverts) are ADMIN-only — COORDINATOR is deliberately left out.
// A global admin sees every gmina's entries; a gmina-scoped admin sees (and
// may revert) only their own gmina's — see the gminaId forcing below and in
// POST /api/admin/logs/[id]/revert. Login attempts (a separate, sibling
// endpoint) stay global-admin-only — LoginAttempt has no gmina FK at all,
// and self-service login attempts aren't scoped to any admin's own gmina in
// a way that's meaningful to show a gmina-scoped admin.
const querySchema = z.object({
  take: z.coerce.number().int().positive().max(MAX_TAKE).optional(),
  cursor: z.string().optional(),
  entityType: z.nativeEnum(AuditEntityType).optional(),
  // A coarse kind (create/update/delete/invite), not the exact per-entity
  // action code — which entity it's about is the separate entityType filter.
  actionKind: z.enum(ACTION_KINDS).optional(),
  actorId: z.string().optional(),
  entityId: z.string().optional(),
  gminaId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // Free-text search across who/what the entry is about — matched
  // server-side so it covers the whole (filtered) log, not just whatever
  // page the client happens to have already loaded. Whitespace-only
  // collapses to "no search" rather than a validation error.
  q: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
});

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe parametry filtrowania.' }, { status: 400 });
  }
  const { take, cursor, entityType, actionKind, actorId, entityId, gminaId, from, to, q } = parsed.data;

  // A gmina-scoped admin's own gmina always wins over (or supplies, when
  // absent) the query param — same "never leave your own scope" contract as
  // everywhere else gmina scoping applies. A global admin's gminaId query
  // param is honored as-is (optional free filter across every gmina).
  const where: Prisma.AuditLogWhereInput = {
    ...(entityType ? { entityType } : {}),
    ...(actionKind ? { action: { in: ACTION_KIND_MAP[actionKind] } } : {}),
    ...(actorId ? { actorId } : {}),
    ...(entityId ? { entityId } : {}),
    ...(isGminaScopedAdmin(admin) ? { gminaId: admin.gminaId! } : gminaId ? { gminaId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { actorEmail: { contains: escapeLikePattern(q), mode: 'insensitive' } },
            { actorName: { contains: escapeLikePattern(q), mode: 'insensitive' } },
            { entityId: { contains: escapeLikePattern(q), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  let logs;
  try {
    logs = await prisma.auditLog.findMany({
      where,
      // Ordered by `seq` (a real, unique, monotonic DB counter), not
      // `createdAt`: a cascading revert can write several rows inside one
      // transaction that all get the identical Postgres CURRENT_TIMESTAMP, and
      // cursor pagination over a non-unique sort column can then skip or
      // duplicate rows whenever a page boundary lands inside such a tied group.
      orderBy: { seq: 'desc' },
      take: (take ?? DEFAULT_TAKE) + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać dziennika zdarzeń.' }, { status: 500 });
  }

  const hasMore = logs.length > (take ?? DEFAULT_TAKE);
  const page = hasMore ? logs.slice(0, -1) : logs;

  return NextResponse.json({
    logs: page.map((log) => ({ ...log, canRevert: canRevert(log) })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}
