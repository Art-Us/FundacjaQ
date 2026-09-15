import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { RefreshOnMount } from '@/components/RefreshOnMount';
import { UsersDirectory } from './UsersDirectory';

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'COORDINATOR')) {
    redirect('/');
  }

  const isAdmin = session.user.role === 'ADMIN';

  // The user LIST itself is no longer fetched here — UsersDirectory loads it
  // (paginated, filtered, searched) from GET /api/admin/users on its own,
  // the same way AuditLogDirectory owns its own data fetching. Only these
  // small lookup lists (for the create/edit form's dropdowns) stay
  // server-rendered, since only ADMIN can create/reassign users anyway.
  const [gminas, organizations] = await Promise.all([
    isAdmin
      ? prisma.gmina.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    isAdmin
      ? prisma.organization.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, gminaId: true } })
      : Promise.resolve([]),
  ]);

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <RefreshOnMount />
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Użytkownicy</h1>
        <p className="text-sm text-slate-500 mt-1">
          {isAdmin
            ? 'Przeglądaj, twórz i zarządzaj kontami wszystkich użytkowników systemu.'
            : 'Przeglądaj i zarządzaj statusem kont wolontariuszy w Twojej gminie.'}
        </p>
      </div>

      <UsersDirectory gminas={gminas} organizations={organizations} isAdmin={isAdmin} />
    </main>
  );
}
