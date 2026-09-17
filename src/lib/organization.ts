import { Prisma, type Organization, type Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Scopes a Prisma `where` filter to `actor`'s own organization for every
 * organization-scoped role (anyone but ADMIN — mirrors scopedGminaWhere in
 * lib/gmina.ts, now the primary scoping mechanism for COORDINATOR access to
 * user management: activating/deactivating, inviting, and listing users).
 * Returns `null` when the actor IS organization-scoped but has no
 * organization of their own.
 *
 * Callers MUST treat `null` as "return nothing" (fail closed) and never
 * substitute an empty `{}` filter for it — `{}` means "no filter", which
 * would hand an organization-scoped actor with no organization the same
 * unrestricted view as an ADMIN. Same fail-open trap scopedGminaWhere's own
 * doc comment warns about (see the 2026-09-10 audit it references).
 */
export function scopedOrganizationWhere(
  actor: { role: Role | string; organizationId?: string | null }
): { organizationId: string } | Record<string, never> | null {
  if (actor.role === 'ADMIN') return {};
  if (!actor.organizationId) return null;
  return { organizationId: actor.organizationId };
}

/** Trims and collapses internal whitespace, so "Caritas" / " Caritas  " / "Caritas" compare equal. */
export function normalizeOrganizationName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export interface CreateOrganizationInput {
  name: string;
  gminaId: string;
  street?: string | null;
  houseNumber?: string | null;
  apartmentNumber?: string | null;
  city?: string | null;
  postalCode?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

type CreateOrganizationResult = { organization: Organization; created: boolean } | { error: string };

/**
 * Finds an existing organization whose name matches `name` (case/whitespace
 * insensitive) WITHIN the given gmina — scoped, not global, since the same
 * organization name plausibly recurs across different gminas (see the
 * `@@unique([name, gminaId])` comment in schema.prisma).
 */
async function findOrganizationByNormalizedName(name: string, gminaId: string) {
  return prisma.organization.findFirst({
    where: { gminaId, name: { equals: name, mode: 'insensitive' } },
  });
}

/**
 * Creates an organization, or returns the existing one if a case/whitespace-
 * insensitive (name, gmina) match already exists — the single place that
 * enforces "no two organizations with the same name in the same gmina",
 * mirroring createGmina() in lib/gmina.ts. Unlike gmina, there is no inline
 * "type a name" creation path anywhere in the UI — organizations are only
 * ever created through the shared OrganizationFormModal (which always POSTs
 * to /api/admin/organizations immediately), so this is the only entry point.
 */
export async function createOrganization(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  const name = normalizeOrganizationName(input.name);
  if (!name) {
    return { error: 'Nazwa organizacji jest wymagana.' };
  }
  if (!input.gminaId) {
    return { error: 'Gmina jest wymagana.' };
  }

  let gmina;
  try {
    gmina = await prisma.gmina.findUnique({ where: { id: input.gminaId }, select: { id: true } });
  } catch {
    return { error: 'Nie udało się zweryfikować gminy.' };
  }
  if (!gmina) {
    return { error: 'Wybrana gmina nie istnieje.' };
  }

  let existing;
  try {
    existing = await findOrganizationByNormalizedName(name, input.gminaId);
  } catch {
    return { error: 'Nie udało się utworzyć organizacji.' };
  }
  if (existing) {
    return { organization: existing, created: false };
  }

  const data: Prisma.OrganizationCreateInput = {
    name,
    gmina: { connect: { id: input.gminaId } },
  };
  if (input.street !== undefined) data.street = input.street;
  if (input.houseNumber !== undefined) data.houseNumber = input.houseNumber;
  if (input.apartmentNumber !== undefined) data.apartmentNumber = input.apartmentNumber;
  if (input.city !== undefined) data.city = input.city;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;
  if (input.contactFirstName !== undefined) data.contactFirstName = input.contactFirstName;
  if (input.contactLastName !== undefined) data.contactLastName = input.contactLastName;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;

  try {
    const organization = await prisma.organization.create({ data });
    return { organization, created: true };
  } catch (err) {
    // Two concurrent requests can both pass the pre-check above — the unique
    // index on (name, gminaId) is case-sensitive, so only an exact-match race
    // lands here, but we still fall back to the normalized lookup for
    // consistency (mirrors createGmina's identical P2002 handling).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raceExisting = await findOrganizationByNormalizedName(name, input.gminaId);
      if (raceExisting) {
        return { organization: raceExisting, created: false };
      }
    }
    return { error: 'Nie udało się utworzyć organizacji.' };
  }
}
