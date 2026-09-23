import { Prisma, type Gmina, type Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** ADMIN accounts are site-wide (see prisma/seed.ts), everyone else must belong to a gmina. */
export function requiresGmina(role: Role): boolean {
  return role !== 'ADMIN';
}

/**
 * Scopes a Prisma `where` filter to `actor`'s own gmina for every gmina-scoped
 * role — anyone but a *global* ADMIN (gminaId === null). A gmina-scoped ADMIN
 * (gminaId set) is scoped exactly like everyone else here — same as
 * COORDINATOR/VOLUNTEER — which is what makes them "the same access as ADMIN,
 * but only in their gmina" (see lib/authz.ts's isGlobalAdmin/isGminaScopedAdmin).
 * Returns `null` when the actor IS gmina-scoped but has no gmina of their own
 * (stale data from before gmina became required, or an admin cleared it via
 * PATCH /api/admin/users/[id]).
 *
 * Callers MUST treat `null` as "return nothing" (fail closed) and never
 * substitute an empty `{}` filter for it — `{}` means "no filter", which
 * would hand a gmina-scoped actor with no gmina the same unrestricted view
 * as a global ADMIN. This was exactly the bug found in the 2026-09-10 audit
 * across admin/invites/page.tsx, admin/users/page.tsx and dashboard.ts.
 */
export function scopedGminaWhere(actor: { role: Role | string; gminaId: string | null }): { gminaId: string } | Record<string, never> | null {
  if (actor.role === 'ADMIN' && !actor.gminaId) return {};
  if (!actor.gminaId) return null;
  return { gminaId: actor.gminaId };
}

/**
 * Same shape as scopedGminaWhere, but for resources, which the product owner
 * decided should stay ADMIN-unconditional regardless of gminaId, unlike
 * everything else (users/invites/gminas/organizations/audit log) — any
 * ADMIN, global or gmina-scoped, sees every gmina's resources. Everyone else
 * (COORDINATOR/VOLUNTEER) is scoped exactly the same as scopedGminaWhere.
 * Alerts (with their needs, allocations and journal) are not scoped at all:
 * every logged-in user sees every alert, in every gmina.
 */
export function scopedGminaWhereAnyAdmin(actor: { role: Role | string; gminaId: string | null }): { gminaId: string } | Record<string, never> | null {
  if (actor.role === 'ADMIN') return {};
  if (!actor.gminaId) return null;
  return { gminaId: actor.gminaId };
}

interface ResolveGminaInput {
  gminaId?: string;
  newGminaName?: string;
}

// `created`/`gmina` let callers audit-log a brand-new gmina created inline
// via `newGminaName` (from the users/invites "+ Nowa gmina" flow) — the only
// case that actually creates a row here; picking an existing gminaId never does.
type ResolveGminaResult = { id: string; created: boolean; gmina: Gmina | null } | { error: string };

/**
 * Resolves an incoming gminaId/newGminaName pair to a concrete Gmina id,
 * reusing an existing gmina (see createGmina) when the caller typed a name
 * that already matches one, instead of picking an existing one from the list.
 */
export async function resolveGminaId({ gminaId, newGminaName }: ResolveGminaInput): Promise<ResolveGminaResult> {
  if (gminaId) {
    let gmina;
    try {
      gmina = await prisma.gmina.findUnique({ where: { id: gminaId }, select: { id: true } });
    } catch {
      return { error: 'Nie udało się zweryfikować gminy.' };
    }
    if (!gmina) {
      return { error: 'Wybrana gmina nie istnieje.' };
    }
    return { id: gmina.id, created: false, gmina: null };
  }

  if (newGminaName) {
    const resolved = await createGmina({ name: newGminaName });
    if ('error' in resolved) {
      return { error: resolved.error };
    }
    return { id: resolved.gmina.id, created: resolved.created, gmina: resolved.gmina };
  }

  return { error: 'Gmina jest wymagana.' };
}

/** Trims and collapses internal whitespace, so "Warszawa" / " Warszawa  " / "Warszawa" compare equal. */
export function normalizeGminaName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export interface GminaLocationOption {
  voivodeship: string;
  powiats: string[];
}

/**
 * Voivodeship/powiat options for the gmina list's cascading filters, derived
 * from whatever gminas actually exist rather than a bundled reference dataset
 * (the codebase has no static Polish administrative-division list) — so the
 * dropdowns only ever offer values a filter could actually match, and a powiat
 * is grouped under every voivodeship it happens to appear under.
 *
 * Deliberately its own endpoint (GET /api/admin/gminas/locations) rather than
 * a field on the paginated list response: these options only change when a
 * gmina is created/edited/deleted, not on every search keystroke, sort, or
 * page turn — bundling them into the hot, frequently-refetched list endpoint
 * would re-run this full-table scan on every one of those instead of once on
 * mount plus after an actual mutation.
 */
export async function getGminaLocationOptions(): Promise<GminaLocationOption[]> {
  const rows = await prisma.gmina.findMany({
    where: { voivodeship: { not: null } },
    select: { voivodeship: true, powiat: true },
    distinct: ['voivodeship', 'powiat'],
  });

  const byVoivodeship = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.voivodeship) continue;
    if (!byVoivodeship.has(row.voivodeship)) byVoivodeship.set(row.voivodeship, new Set());
    if (row.powiat) byVoivodeship.get(row.voivodeship)!.add(row.powiat);
  }

  return Array.from(byVoivodeship.entries())
    .map(([voivodeship, powiats]) => ({
      voivodeship,
      powiats: Array.from(powiats).sort((a, b) => a.localeCompare(b, 'pl')),
    }))
    .sort((a, b) => a.voivodeship.localeCompare(b.voivodeship, 'pl'));
}

export interface CreateGminaInput {
  name: string;
  powiat?: string | null;
  voivodeship?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

type CreateGminaResult = { gmina: Gmina; created: boolean } | { error: string };

/**
 * Finds an existing gmina whose name matches `name` regardless of case or
 * whitespace differences, treating that as "the same gmina" rather than a
 * candidate for a new duplicate row.
 */
async function findGminaByNormalizedName(name: string) {
  return prisma.gmina.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
}

/**
 * Creates a gmina, or returns the existing one if a case/whitespace-insensitive
 * match already exists — this is the single place that enforces "no two
 * gminas with the same name", shared by the invites/users inline "+ Nowa
 * gmina" flow (via resolveGminaId) and the dedicated gmina management CRUD.
 */
export async function createGmina(input: CreateGminaInput): Promise<CreateGminaResult> {
  const name = normalizeGminaName(input.name);
  if (!name) {
    return { error: 'Nazwa gminy jest wymagana.' };
  }

  let existing;
  try {
    existing = await findGminaByNormalizedName(name);
  } catch {
    return { error: 'Nie udało się utworzyć gminy.' };
  }
  if (existing) {
    return { gmina: existing, created: false };
  }

  const data: Prisma.GminaCreateInput = { name };
  if (input.powiat !== undefined) data.powiat = input.powiat;
  if (input.voivodeship !== undefined) data.voivodeship = input.voivodeship;
  if (input.latitude !== undefined) data.latitude = input.latitude;
  if (input.longitude !== undefined) data.longitude = input.longitude;

  try {
    const gmina = await prisma.gmina.create({ data });
    return { gmina, created: true };
  } catch (err) {
    // Two concurrent requests can both pass the pre-check above — the unique
    // index on `name` is case-sensitive, so only an exact-name race lands
    // here, but we still fall back to the normalized lookup for consistency.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raceExisting = await findGminaByNormalizedName(name);
      if (raceExisting) {
        return { gmina: raceExisting, created: false };
      }
    }
    return { error: 'Nie udało się utworzyć gminy.' };
  }
}
