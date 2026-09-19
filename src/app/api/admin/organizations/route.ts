import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { createOrganization } from '@/lib/organization';
import { recordAudit, requestMeta, snapshotOrganization } from '@/lib/auditLog';
import { escapeLikePattern } from '@/lib/utils';

export const runtime = 'nodejs';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const SORT_FIELDS = ['name', 'city', 'gmina', 'createdAt'] as const;
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
  sortBy: z.enum(SORT_FIELDS).optional().default('name'),
  sortDir: z.enum(SORT_DIRS).optional().default('asc'),
});

/** `id` as a stable tiebreaker, same rationale as the gmina list's buildOrderBy. */
function buildOrderBy(sortBy: SortField, sortDir: SortDir): Prisma.OrganizationOrderByWithRelationInput[] {
  const primary: Prisma.OrganizationOrderByWithRelationInput =
    sortBy === 'city'
      ? { city: sortDir }
      : sortBy === 'gmina'
        ? { gmina: { name: sortDir } }
        : sortBy === 'createdAt'
          ? { createdAt: sortDir }
          : { name: sortDir };
  return [primary, { id: 'asc' }];
}

function buildSearchOr(q: string): Prisma.OrganizationWhereInput[] {
  const escaped = escapeLikePattern(q);
  return [
    { name: { contains: escaped, mode: 'insensitive' } },
    { city: { contains: escaped, mode: 'insensitive' } },
    { contactFirstName: { contains: escaped, mode: 'insensitive' } },
    { contactLastName: { contains: escaped, mode: 'insensitive' } },
    { gmina: { name: { contains: escaped, mode: 'insensitive' } } },
  ];
}

const organizationFieldsSchema = z.object({
  street: z.string().trim().max(200).nullable().optional(),
  houseNumber: z.string().trim().max(20).nullable().optional(),
  apartmentNumber: z.string().trim().max(20).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  contactFirstName: z.string().trim().max(120).nullable().optional(),
  contactLastName: z.string().trim().max(120).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .nullable()
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, { message: 'Nieprawidłowy adres email kontaktu.' }),
});

const createOrganizationSchema = organizationFieldsSchema.extend({
  name: z.string().trim().min(1).max(200),
  gminaId: z.string().min(1, 'Gmina jest wymagana.'),
});

// Organizations are always created immediately through this endpoint —
// unlike gmina, there is no deferred "inline text + resolve on parent
// submit" path anywhere in the UI (see lib/organization.ts's doc comment).
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = createOrganizationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { name, gminaId, ...fields } = parsed.data;
  const result = await createOrganization({
    name,
    gminaId,
    ...fields,
    contactEmail: fields.contactEmail || null,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (!result.created) {
    return NextResponse.json({ error: 'Organizacja o tej nazwie już istnieje w tej gminie.' }, { status: 409 });
  }

  await recordAudit({
    actor: admin,
    action: 'ORGANIZATION_CREATE',
    entityType: 'ORGANIZATION',
    entityId: result.organization.id,
    gminaId: result.organization.gminaId,
    after: snapshotOrganization(result.organization),
    meta: requestMeta(req),
  });

  return NextResponse.json({ organization: result.organization }, { status: 201 });
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
  const { page, pageSize, q, sortBy, sortDir } = parsed.data;

  const where: Prisma.OrganizationWhereInput = {
    ...(q ? { OR: buildSearchOr(q) } : {}),
  };

  try {
    const [total, organizations] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({
        where,
        orderBy: buildOrderBy(sortBy, sortDir),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          gmina: { select: { id: true, name: true } },
          _count: { select: { users: true } },
        },
      }),
    ]);

    return NextResponse.json({
      organizations,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać listy organizacji.' }, { status: 500 });
  }
}
