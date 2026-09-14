import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { createOrganization } from '@/lib/organization';
import { recordAudit, requestMeta, snapshotOrganization } from '@/lib/auditLog';

export const runtime = 'nodejs';

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

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const organizations = await prisma.organization.findMany({
    orderBy: { name: 'asc' },
    include: {
      gmina: { select: { id: true, name: true } },
      _count: { select: { users: true } },
    },
  });

  return NextResponse.json({ organizations });
}
