import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuditEntityType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { canRevert, ACTION_KINDS, ACTION_KIND_MAP } from '@/lib/auditLog';

export const runtime = 'nodejs';

const MAX_TAKE = 100;
const DEFAULT_TAKE = 50;

// Logs (and reverts) are ADMIN-only for now — COORDINATOR is deliberately
// left out. A gmina-scoped view would need the same scopedGminaWhere
// treatment as everywhere else in lib/gmina.ts, and getting that wrong once
// already produced a real IDOR (2026-09-10 audit); until that's built and
// reviewed on purpose, showing the trail to anyone but ADMIN is out of scope.
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
  const { take, cursor, entityType, actionKind, actorId, entityId, gminaId, from, to } = parsed.data;

  const where: Prisma.AuditLogWhereInput = {
    ...(entityType ? { entityType } : {}),
    ...(actionKind ? { action: { in: ACTION_KIND_MAP[actionKind] } } : {}),
    ...(actorId ? { actorId } : {}),
    ...(entityId ? { entityId } : {}),
    ...(gminaId ? { gminaId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const logs = await prisma.auditLog.findMany({
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

  const hasMore = logs.length > (take ?? DEFAULT_TAKE);
  const page = hasMore ? logs.slice(0, -1) : logs;

  return NextResponse.json({
    logs: page.map((log) => ({ ...log, canRevert: canRevert(log) })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}
