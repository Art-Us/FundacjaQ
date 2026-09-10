import type { Role } from '@prisma/client';
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
 * creating a new Gmina (name only — powiat/voivodeship left unset) when the
 * caller typed a fresh name instead of picking an existing one.
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
    const name = newGminaName.trim();
    const existing = await prisma.gmina.findUnique({ where: { name }, select: { id: true } });
    if (existing) {
      return { id: existing.id };
    }
    const created = await prisma.gmina.create({ data: { name }, select: { id: true } });
    return { id: created.id };
  }

  return { error: 'Gmina jest wymagana.' };
}
