import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import { authOptions } from './auth';
import { prisma } from './prisma';

export interface AuthorizedUser {
  id: string;
  role: string;
  gminaId: string | null;
  // Present on the real NextAuth session (see types/next-auth.d.ts,
  // DefaultSession['user']) but optional here, like email/name below, so the
  // many existing call sites/tests that only care about id/role/gminaId
  // don't need to supply it. Every function that reads it (canManageUser,
  // scopedOrganizationWhere) treats a missing value the same as `null` —
  // fails closed, never "unrestricted".
  organizationId?: string | null;
  // Present on the real NextAuth session (see types/next-auth.d.ts,
  // DefaultSession['user']) but optional here so existing call sites/tests
  // that only care about id/role/gminaId don't need to supply them. Used for
  // attributing audit log entries (see lib/auditLog.ts) to a human-readable actor.
  email?: string | null;
  name?: string | null;
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
 * Returns the current session user regardless of role, or null if
 * unauthenticated. Unlike requireAdmin/requireAdminOrCoordinator above, this
 * imposes no role restriction at all — for endpoints whose access is gated
 * by something else entirely (e.g. the alert's own visibility/gmina scope),
 * not by role. Introduced for the alert operational journal/forum (Крок 53,
 * docs/resource_management_plan.md) — VOLUNTEER can read it, same as it can
 * see the alert itself on the map, which none of the rest of the resource
 * module (locked to ADMIN/COORDINATOR) allows.
 */
export async function requireUser(): Promise<AuthorizedUser | null> {
  const session = await getServerSession(authOptions);
  return session?.user ?? null;
}

/**
 * Whether `actor` may activate/deactivate `target`. ADMIN can manage anyone;
 * COORDINATOR only their own organization's VOLUNTEERs (mirrors the
 * invite-role restriction in POST /api/admin/invites) — scoped by
 * organization, not gmina, so a coordinator with no organization of their
 * own can manage nobody at all, same as scopedOrganizationWhere's fail-closed
 * contract for list visibility. Nobody can act on their own account, since
 * isActive is re-checked live on every session refresh (src/lib/auth.ts jwt
 * callback) — self-deactivation would kill the actor's own session
 * mid-request with no way to undo it.
 */
export function canManageUser(
  actor: AuthorizedUser,
  target: { id: string; role: string; organizationId: string | null }
): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === 'ADMIN') return true;
  return (
    target.role === 'VOLUNTEER' && target.organizationId !== null && target.organizationId === (actor.organizationId ?? null)
  );
}

/**
 * Whether deleting or deactivating `target` would leave the system with zero
 * active ADMIN accounts — the only way anyone could get back in at that point
 * is a direct database/seed-script fix, so this must never be allowed,
 * regardless of who requests it or whether they're acting on themselves or
 * someone else. Only meaningful for a target that IS currently an active
 * admin; anyone else can never affect the active-admin count by definition.
 *
 * This is a plain count-then-act check — two admins deactivating/deleting
 * each other in the exact same instant, via two different transactions,
 * could in theory still both pass it. That residual race is accepted as
 * effectively impossible to hit in practice, not engineered around with
 * row locking. Pass `client` (a `tx` from `prisma.$transaction(async tx =>
 * ...)`) when calling this from inside a transaction that itself acts on
 * the count's result — e.g. lib/auditLog.ts's revertUser — so the count is
 * at least read through that same transaction rather than a second,
 * unrelated connection.
 */
export async function isLastActiveAdmin(
  target: { role: string; isActive: boolean },
  client: Pick<Prisma.TransactionClient, 'user'> = prisma
): Promise<boolean> {
  if (target.role !== 'ADMIN' || !target.isActive) return false;
  const activeAdminCount = await client.user.count({ where: { role: 'ADMIN', isActive: true } });
  return activeAdminCount <= 1;
}

/**
 * Whether applying `next` to `target` would leave it no longer an active
 * ADMIN — i.e. the role changing away from ADMIN, or isActive being turned
 * off. Deactivation alone used to be the only trigger checked against
 * isLastActiveAdmin(); a role change away from ADMIN (with isActive left
 * untouched) needs the exact same guard, since it has the same effect on the
 * active-admin count.
 */
export function wouldLoseActiveAdminStatus(
  target: { role: string; isActive: boolean },
  next: { role: string; isActive: boolean }
): boolean {
  return target.role === 'ADMIN' && target.isActive && (next.role !== 'ADMIN' || !next.isActive);
}

// Resource module authz (docs/are-you-familiar-with-tidy-blum.md, розділ 4)
// and the alert operational journal/forum authz (docs/resource_management_plan.md
// Фаза 8, Крок 52): these all live in lib/resourceAuthz.ts instead of here,
// and are just re-exported below — see that file's header comment for why (a
// 'use client' component needs them without pulling next-auth/ioredis into
// the browser bundle).
export {
  isAlertOwnerOrg,
  isAllocationDonor,
  isAllocationRecipient,
  canManageAlert,
  isAlertDonorOrg,
  canPostAlertJournalEntry,
  canReplyToAlertForum,
  canViewAlertJournal,
} from './resourceAuthz';