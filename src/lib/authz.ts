import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

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