import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { escapeLikePattern } from '@/lib/utils';

export const runtime = 'nodejs';

const MAX_TAKE = 100;
const DEFAULT_TAKE = 50;

// Read-only, ADMIN-only — same reasoning as GET /api/admin/logs: no
// gmina-scoped view exists yet, and this is a security-relevant trail, so
// COORDINATOR is deliberately left out until that's built on purpose.
const querySchema = z.object({
  take: z.coerce.number().int().positive().max(MAX_TAKE).optional(),
  cursor: z.string().optional(),
  email: z.string().optional(),
  success: z.enum(['true', 'false']).optional(),
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
  const { take, cursor, email, success, from, to } = parsed.data;

  const where: Prisma.LoginAttemptWhereInput = {
    ...(email ? { email: { contains: escapeLikePattern(email), mode: 'insensitive' } } : {}),
    ...(success !== undefined ? { success: success === 'true' } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  let attempts;
  try {
    attempts = await prisma.loginAttempt.findMany({
      where,
      // `id` as a tiebreaker so cursor pagination stays deterministic across
      // rows sharing the same createdAt millisecond.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: (take ?? DEFAULT_TAKE) + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać dziennika logowań.' }, { status: 500 });
  }

  const hasMore = attempts.length > (take ?? DEFAULT_TAKE);
  const page = hasMore ? attempts.slice(0, -1) : attempts;

  return NextResponse.json({
    items: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  });
}
