import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/utils';
import { CreateInviteForm } from './CreateInviteForm';
import { RevokeInviteButton } from './RevokeInviteButton';

export default async function AdminInvitesPage() {
  const session = await getSession();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'COORDINATOR')) {
    redirect('/');
  }

  const isAdmin = session.user.role === 'ADMIN';
  const userId = session.user.id;
  const gminaFilter = isAdmin || !session.user.gminaId ? {} : { gminaId: session.user.gminaId };

  const [invites, users] = await Promise.all([
    prisma.inviteToken.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.user.findMany({
      where: gminaFilter,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { gmina: true },
    }),
  ]);

  return (
    <main className="flex-1 px-4 py-16 container mx-auto">
      <h1 className="text-2xl font-bold text-slate-100 mb-8">Zaproszenia</h1>
      <div className="grid gap-10 md:grid-cols-2">
        <CreateInviteForm />
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-300">
            <thead className="text-slate-500 border-b border-slate-800">
              <tr>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Rola</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Wygasa</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
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
                  <tr key={invite.id} className="border-b border-slate-900">
                    <td className="py-2 pr-4">{invite.email}</td>
                    <td className="py-2 pr-4">{invite.role}</td>
                    <td className="py-2 pr-4">{status}</td>
                    <td className="py-2 pr-4">{formatDate(invite.expiresAt)}</td>
                    <td className="py-2 pr-4">{canRevoke && <RevokeInviteButton inviteId={invite.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="text-xl font-bold text-slate-100 mt-16 mb-6">Użytkownicy</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-slate-300">
          <thead className="text-slate-500 border-b border-slate-800">
            <tr>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Nazwa</th>
              <th className="py-2 pr-4">Rola</th>
              <th className="py-2 pr-4">Gmina</th>
              <th className="py-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-slate-900">
                <td className="py-2 pr-4">{user.email}</td>
                <td className="py-2 pr-4">{user.name ?? '—'}</td>
                <td className="py-2 pr-4">{user.role}</td>
                <td className="py-2 pr-4">{user.gmina?.name ?? '—'}</td>
                <td className="py-2 pr-4">{user.isActive ? 'Aktywny' : 'Nieaktywny'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
