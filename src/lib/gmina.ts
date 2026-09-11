import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** ADMIN accounts are site-wide (see prisma/seed.ts), everyone else must belong to a gmina. */
export function requiresGmina(role: Role): boolean {
  return role !== 'ADMIN';
}

/**
 * Scopes a Prisma `where` filter to `actor`'s own gmina for every gmina-scoped
 * role (anyone but ADMIN). Returns `null` when the actor IS gmina-scoped but
 * has no gmina of their own (stale data from before gmina became required, or
 * an admin cleared it via PATCH /api/admin/users/[id]).
 *
 * Callers MUST treat `null` as "return nothing" (fail closed) and never
 * substitute an empty `{}` filter for it — `{}` means "no filter", which
 * would hand a gmina-scoped actor with no gmina the same unrestricted view
 * as an ADMIN. This was exactly the bug found in the 2026-09-10 audit across
 * admin/invites/page.tsx, admin/users/page.tsx and dashboard.ts.
 */
export function scopedGminaWhere(actor: { role: Role | string; gminaId: string | null }): { gminaId: string } | Record<string, never> | null {
  if (actor.role === 'ADMIN') return {};
  if (!actor.gminaId) return null;
  return { gminaId: actor.gminaId };
}

interface ResolveGminaInput {
  gminaId?: string;
  newGminaName?: string;
}

type ResolveGminaResult = { id: string } | { error: string };

/**
 * Resolves an incoming gminaId/newGminaName pair to a concrete Gmina id,
 * reusing an existing gmina (see createGmina) when the caller typed a name
 * that already matches one, instead of picking an existing one from the list.
 */
export async function resolveGminaId({ gminaId, newGminaName }: ResolveGminaInput): Promise<ResolveGminaResult> {
  if (gminaId) {
    const gmina = await prisma.gmina.findUnique({ where: { id: gminaId }, select: { id: true } });
    if (!gmina) {
      return { error: 'Wybrana gmina nie istnieje.' };
    }
    return { id: gmina.id };
  }

  if (newGminaName) {
    const resolved = await createGmina({ name: newGminaName });
    if ('error' in resolved) {
      return { error: resolved.error };
    }
    return { id: resolved.gmina.id };
  }

  return { error: 'Gmina jest wymagana.' };
}

/** Trims and collapses internal whitespace, so "Warszawa" / " Warszawa  " / "Warszawa" compare equal. */
export function normalizeGminaName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export interface CreateGminaInput {
  name: string;
  powiat?: string | null;
  voivodeship?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

type CreateGminaResult =
  | { gmina: { id: string; name: string }; created: true }
  | { gmina: { id: string; name: string }; created: false }
  | { error: string };

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

  const existing = await findGminaByNormalizedName(name);
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
