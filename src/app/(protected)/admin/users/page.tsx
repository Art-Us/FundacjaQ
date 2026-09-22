import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { isGlobalAdmin } from '@/lib/authz';
import { scopedGminaWhere } from '@/lib/gmina';
import { AdminEventsRefresh } from '@/components/AdminEventsRefresh';
import { UsersDirectory } from './UsersDirectory';
import { ClearNewUserNotice } from './ClearNewUserNotice';

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'COORDINATOR')) {
    redirect('/');
  }

  const isAdmin = session.user.role === 'ADMIN';
  const canGrantAdmin = isGlobalAdmin(session.user);

  // A gmina-scoped admin's gmina/organization pickers only ever offer their
  // own gmina and its organizations — same fail-closed contract used
  // everywhere else gmina scoping applies (see lib/gmina.ts's doc comment).
  const gminaFilter = scopedGminaWhere(session.user);
  // Gmina itself has no `gminaId` column — its own `id` IS the gmina — so
  // gminaFilter's `{ gminaId }` shape needs translating to `{ id }` before
  // it can scope the Gmina table directly (Organization DOES have gminaId,
  // so gminaFilter is used as-is for that one).
  const gminaIdFilter = gminaFilter && 'gminaId' in gminaFilter ? { id: gminaFilter.gminaId } : {};

  // The user LIST itself is no longer fetched here — UsersDirectory loads it
  // (paginated, filtered, searched) from GET /api/admin/users on its own,
  // the same way AuditLogDirectory owns its own data fetching. Only these
  // small lookup lists (for the create/edit form's dropdowns) stay
  // server-rendered, since only ADMIN can create/reassign users anyway.
  const [gminas, organizations] = await Promise.all([
    isAdmin && gminaFilter !== null
      ? prisma.gmina.findMany({ where: gminaIdFilter, orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    isAdmin && gminaFilter !== null
      ? prisma.organization.findMany({
          where: gminaFilter,
          orderBy: { name: 'asc' },
          select: { id: true, name: true, gminaId: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      {/* The user LIST refreshes itself (UsersDirectory listens for 'users'
          events client-side) — this only covers the gmina/organization
          dropdown props above, which are fetched here on the server and
          would otherwise go stale until the next full navigation. */}
      <AdminEventsRefresh scope={['gminas', 'organizations']} />
      {/* The dot itself is ADMIN-only (Sidebar.tsx) — no point mounting the
          listener for a COORDINATOR, who could never have lit it up. */}
      {isAdmin && <ClearNewUserNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Użytkownicy</h1>
        <p className="text-sm text-slate-500 mt-1">
          {isAdmin
            ? 'Przeglądaj, twórz i zarządzaj kontami wszystkich użytkowników systemu.'
            : 'Przeglądaj i zarządzaj statusem kont wolontariuszy w Twojej gminie.'}
        </p>
      </div>

      <UsersDirectory
        gminas={gminas}
        organizations={organizations}
        isAdmin={isAdmin}
        canGrantAdmin={canGrantAdmin}
        canCreateGmina={canGrantAdmin}
      />
    </main>
  );
}
