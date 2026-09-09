import type { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** ADMIN accounts are site-wide (see prisma/seed.ts), everyone else must belong to a gmina. */
export function requiresGmina(role: Role): boolean {
  return role !== 'ADMIN';
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
