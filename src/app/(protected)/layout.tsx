import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isGlobalAdmin } from '@/lib/authz';
import { countActionableAllocations } from '@/lib/allocationInbox';
import { ProtectedShell } from '@/components/layout/ProtectedShell';

// The authoritative session check for every non-public page. Unlike middleware.ts
// (which only decrypts the cookie), getSession() runs authOptions.callbacks.jwt()
// against the current DB state, so a deactivated account, a changed password, or an
// active lockout kills access here immediately, even mid-session. Any page nested
// under this route group gets that guarantee without having to remember to check itself.
//
// getSession() is React-cache()'d, so pages under this layout that need the session's
// data (role, gminaId, ...) should also call getSession() rather than getServerSession()
// directly — within one request they share this single DB round trip instead of each
// paying for their own.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) {
    // A live-invalidated session (see auth.ts jwt callback) still has a session
    // object — just no user — so it can carry *why* it was invalidated. Only a
    // deactivated account gets the "blocked" page; a stale password or a
    // temporary lockout falls back to the plain login redirect.
    redirect(session?.blocked ? '/account-blocked' : '/login');
  }

  const { role, organizationId } = session.user;
  const canManageInvites = role === 'ADMIN' || role === 'COORDINATOR';
  // Gmina management stays global-admin-only (see api/admin/gminas/route.ts)
  // — a gmina-scoped admin has `role === 'ADMIN'` too, so this can't reuse
  // the plain role check the way canManageInvites/canManageResources do.
  const canManageGminas = isGlobalAdmin(session.user);
  // Same ADMIN/COORDINATOR gate as the /zasoby page itself (Крок 31) — kept
  // as its own flag rather than reusing canManageInvites, since the two
  // happen to share a condition today but gate unrelated features.
  const canManageResources = role === 'ADMIN' || role === 'COORDINATOR';
  const resourceInboxCount = canManageResources ? await countActionableAllocations(organizationId) : 0;

  return (
    <ProtectedShell
      name={session.user.name ?? session.user.email ?? 'Użytkownik'}
      role={role}
      canManageInvites={canManageInvites}
      canManageResources={canManageResources}
      canManageGminas={canManageGminas}
      resourceInboxCount={resourceInboxCount}
    >
      {children}
    </ProtectedShell>
  );
}
