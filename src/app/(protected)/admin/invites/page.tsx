import { redirect } from 'next/navigation';
import { Mail } from 'lucide-react';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/utils';
import { canManageUser } from '@/lib/authz';
import { scopedGminaWhere } from '@/lib/gmina';
import { ToggleUserActiveButton } from '@/components/users/ToggleUserActiveButton';
import { CreateInviteForm } from './CreateInviteForm';
import { RevokeInviteButton } from './RevokeInviteButton';

const INVITE_STATUS_BADGE: Record<string, string> = {
  Aktywne: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Wykorzystane: 'bg-slate-100 text-slate-600 border-slate-200',
  Unieważnione: 'bg-rose-50 text-rose-700 border-rose-200',
  Wygasłe: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default async function AdminInvitesPage() {
  const session = await getSession();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'COORDINATOR')) {
    redirect('/');
  }

  const currentUser = session.user;
  const isAdmin = currentUser.role === 'ADMIN';
  const userId = currentUser.id;
  // null means "gmina-scoped actor with no gmina of their own" — fail closed
  // (see scopedGminaWhere's doc comment), never fall back to an unfiltered {}.
  const gminaFilter = scopedGminaWhere(currentUser);

  const [invites, users, gminas] = await Promise.all([
    prisma.inviteToken.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    gminaFilter === null
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: gminaFilter,
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { gmina: true },
        }),
    // Only ADMIN picks/creates a gmina when inviting; a coordinator's invite
    // always goes to their own gmina, so they never need the full list.
    isAdmin
      ? prisma.gmina.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-6">Zaproszenia</h1>
        <div className="grid gap-6 md:grid-cols-2 items-start">
          <CreateInviteForm gminas={gminas} isAdmin={isAdmin} currentUserGminaId={currentUser.gminaId} />
          <div className="min-w-0 bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-200/80 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Rola</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Wygasa</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invites.map((invite) => {
                    const status = invite.usedAt
                      ? 'Wykorzystane'
                      : invite.revokedAt
                      ? 'Unieważnione'
                      : invite.expiresAt.getTime() < Date.now()
                      ? 'Wygasłe'
                      : 'Aktywne';
                    const canRevoke = status === 'Aktywne' && (isAdmin || invite.createdById === userId);
                    return (
                      <tr key={invite.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                            <Mail className="h-3.5 w-3.5 text-slate-400" />
                            <span>{invite.email}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-600">{invite.role}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${INVITE_STATUS_BADGE[status]}`}>
                            {status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500">{formatDate(invite.expiresAt)}</td>
                        <td className="py-3 px-4 text-right">{canRevoke && <RevokeInviteButton inviteId={invite.id} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-6">Użytkownicy</h2>
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200/80 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Nazwa</th>
                  <th className="py-3 px-4">Rola</th>
                  <th className="py-3 px-4">Gmina</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Ostatnia aktywacja</th>
                  <th className="py-3 px-4">Ostatnia dezaktywacja</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3 px-4 font-semibold text-slate-800">{user.email}</td>
                    <td className="py-3 px-4 text-slate-600">{user.name ?? '—'}</td>
                    <td className="py-3 px-4 text-slate-600">{user.role}</td>
                    <td className="py-3 px-4 text-slate-600">{user.gmina?.name ?? '—'}</td>
                    <td className="py-3 px-4">
                      {user.isActive ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                          Aktywny
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200">
                          Nieaktywny
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {user.lastActivatedAt ? formatDate(user.lastActivatedAt) : '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {user.lastDeactivatedAt ? (
                        <span title={user.deactivationReason ?? undefined}>
                          {formatDate(user.lastDeactivatedAt)}
                          {user.deactivationReason ? ` (${user.deactivationReason})` : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {canManageUser(currentUser, user) && (
                        <ToggleUserActiveButton userId={user.id} isActive={user.isActive} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
