import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { createGmina } from '@/lib/gmina';
import { recordAudit, requestMeta, snapshotGmina } from '@/lib/auditLog';
import { escapeLikePattern } from '@/lib/utils';

export const runtime = 'nodejs';

const gminaFieldsSchema = z.object({
  powiat: z.string().trim().max(120).nullable().optional(),
  voivodeship: z.string().trim().max(120).nullable().optional(),
  latitude: z.number().gte(-90).lte(90).nullable().optional(),
  longitude: z.number().gte(-180).lte(180).nullable().optional(),
});

const createGminaSchema = gminaFieldsSchema.extend({
  name: z.string().trim().min(1).max(120),
});

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const SORT_FIELDS = ['name', 'voivodeship', 'powiat', 'createdAt'] as const;
const SORT_DIRS = ['asc', 'desc'] as const;
type SortField = (typeof SORT_FIELDS)[number];
type SortDir = (typeof SORT_DIRS)[number];

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(1_000_000).optional().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
  q: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  voivodeship: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  powiat: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined),
  sortBy: z.enum(SORT_FIELDS).optional().default('name'),
  sortDir: z.enum(SORT_DIRS).optional().default('asc'),
});

/** `id` as a stable tiebreaker, same rationale as the users list's buildOrderBy. */
function buildOrderBy(sortBy: SortField, sortDir: SortDir): Prisma.GminaOrderByWithRelationInput[] {
  const primary: Prisma.GminaOrderByWithRelationInput =
    sortBy === 'voivodeship'
      ? { voivodeship: sortDir }
      : sortBy === 'powiat'
        ? { powiat: sortDir }
        : sortBy === 'createdAt'
          ? { createdAt: sortDir }
          : { name: sortDir };
  return [primary, { id: 'asc' }];
}

function buildSearchOr(q: string): Prisma.GminaWhereInput[] {
  const escaped = escapeLikePattern(q);
  return [
    { name: { contains: escaped, mode: 'insensitive' } },
    { powiat: { contains: escaped, mode: 'insensitive' } },
    { voivodeship: { contains: escaped, mode: 'insensitive' } },
  ];
}

// Shared by the admin invites/users "+ Nowa gmina" inline create and the
// dedicated gmina management page — see createGmina() for the single place
// that decides whether a name is a duplicate.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = createGminaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { name, ...fields } = parsed.data;
  const result = await createGmina({ name, ...fields });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (!result.created) {
    return NextResponse.json({ error: 'Gmina o tej nazwie już istnieje.' }, { status: 409 });
  }

  await recordAudit({
    actor: admin,
    action: 'GMINA_CREATE',
    entityType: 'GMINA',
    entityId: result.gmina.id,
    gminaId: result.gmina.id,
    after: snapshotGmina(result.gmina),
    meta: requestMeta(req),
  });

  return NextResponse.json({ gmina: result.gmina }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe parametry filtrowania.' }, { status: 400 });
  }
  const { page, pageSize, q, voivodeship, powiat, sortBy, sortDir } = parsed.data;

  const where: Prisma.GminaWhereInput = {
    ...(voivodeship ? { voivodeship } : {}),
    ...(powiat ? { powiat } : {}),
    ...(q ? { OR: buildSearchOr(q) } : {}),
  };

  try {
    const [total, gminas] = await Promise.all([
      prisma.gmina.count({ where }),
      prisma.gmina.findMany({
        where,
        orderBy: buildOrderBy(sortBy, sortDir),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { users: true, resources: true, alerts: true, inviteTokens: true, organizations: true } },
        },
      }),
    ]);

    return NextResponse.json({
      gminas,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać listy gmin.' }, { status: 500 });
  }
}
