import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/utils';
import { canManageUser } from '@/lib/authz';
import { scopedGminaWhere } from '@/lib/gmina';
import { adminUserSelect } from '@/lib/users';
import { RefreshOnMount } from '@/components/RefreshOnMount';
import { UsersDirectory } from './UsersDirectory';
import type { UserListItem } from './types';

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'COORDINATOR')) {
    redirect('/');
  }

  const currentUser = session.user;
  const isAdmin = currentUser.role === 'ADMIN';
  // Mirrors admin/invites: a coordinator only ever sees their own gmina.
  // null means "coordinator with no gmina of their own" — fail closed, never {}.
  const gminaFilter = scopedGminaWhere(currentUser);

  const [users, gminas, organizations] = await Promise.all([
    gminaFilter === null
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: gminaFilter,
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { ...adminUserSelect, gmina: { select: { id: true, name: true } } },
        }),
    // Only ADMIN can create/reassign users, so coordinators never need the full list.
    isAdmin
      ? prisma.gmina.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    isAdmin
      ? prisma.organization.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, gminaId: true } })
      : Promise.resolve([]),
  ]);

  const items: UserListItem[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organization: user.organization ? { id: user.organization.id, name: user.organization.name } : null,
    phone: user.phone,
    isActive: user.isActive,
    lastActivatedAt: user.lastActivatedAt ? formatDate(user.lastActivatedAt) : null,
    lastDeactivatedAt: user.lastDeactivatedAt ? formatDate(user.lastDeactivatedAt) : null,
    deactivationReason: user.deactivationReason,
    gmina: user.gmina ? { id: user.gmina.id, name: user.gmina.name } : null,
    isSelf: user.id === currentUser.id,
    canManage: canManageUser(currentUser, user),
  }));

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

      <UsersDirectory users={items} gminas={gminas} organizations={organizations} isAdmin={isAdmin} />
    </main>
  );
}
