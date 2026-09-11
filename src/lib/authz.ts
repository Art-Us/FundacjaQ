import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { prisma } from './prisma';

export interface AuthorizedUser {
  id: string;
  role: string;
  gminaId: string | null;
}

/** Returns the current session user if they're ADMIN or COORDINATOR, otherwise null. */
export async function requireAdminOrCoordinator(): Promise<AuthorizedUser | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'COORDINATOR')) {
    return null;
  }
  return user;
}

/** Returns the current session user if they're ADMIN, otherwise null. */
export async function requireAdmin(): Promise<AuthorizedUser | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user || user.role !== 'ADMIN') {
    return null;
  }
  return user;
}

/**
 * Whether `actor` may activate/deactivate `target`. ADMIN can manage anyone;
 * COORDINATOR only their own gmina's VOLUNTEERs (mirrors the invite-role
 * restriction in POST /api/admin/invites). Nobody can act on their own
 * account, since isActive is re-checked live on every session refresh
 * (src/lib/auth.ts jwt callback) — self-deactivation would kill the actor's
 * own session mid-request with no way to undo it.
 */
export function canManageUser(
  actor: AuthorizedUser,
  target: { id: string; role: string; gminaId: string | null }
): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === 'ADMIN') return true;
  return target.role === 'VOLUNTEER' && target.gminaId !== null && target.gminaId === actor.gminaId;
}

/**
 * Whether deleting or deactivating `target` would leave the system with zero
 * active ADMIN accounts — the only way anyone could get back in at that point
 * is a direct database/seed-script fix, so this must never be allowed,
 * regardless of who requests it or whether they're acting on themselves or
 * someone else. Only meaningful for a target that IS currently an active
 * admin; anyone else can never affect the active-admin count by definition.
 *
 * This is a plain count-then-act check, not a transaction — two admins
 * deactivating/deleting each other in the exact same instant could in theory
 * still both pass it. That residual race is accepted as effectively
 * impossible to hit in practice, not engineered around with locking.
 */
export async function isLastActiveAdmin(target: { role: string; isActive: boolean }): Promise<boolean> {
  if (target.role !== 'ADMIN' || !target.isActive) return false;
  const activeAdminCount = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
  return activeAdminCount <= 1;
}