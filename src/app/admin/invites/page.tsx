import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/utils';
import { CreateInviteForm } from './CreateInviteForm';

export default async function AdminInvitesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'COORDINATOR')) {
    redirect('/');
  }

  const invites = await prisma.inviteToken.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

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
                return (
                  <tr key={invite.id} className="border-b border-slate-900">
                    <td className="py-2 pr-4">{invite.email}</td>
                    <td className="py-2 pr-4">{invite.role}</td>
                    <td className="py-2 pr-4">{status}</td>
                    <td className="py-2 pr-4">{formatDate(invite.expiresAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
