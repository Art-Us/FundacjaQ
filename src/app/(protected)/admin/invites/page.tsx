import { redirect } from 'next/navigation';
import { Mail, Send } from 'lucide-react';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/utils';
import { scopedOrganizationWhere } from '@/lib/organization';
import { AdminEventsRefresh } from '@/components/AdminEventsRefresh';
import { CreateInviteForm } from './CreateInviteForm';
import { ToggleInviteButton, type InviteStatus } from './ToggleInviteButton';

const INVITE_STATUS_BADGE: Record<InviteStatus, string> = {
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
  // null means "organization-scoped actor with no organization of their
  // own" — fail closed (see scopedOrganizationWhere's doc comment), never
  // fall back to an unfiltered {}.
  const organizationFilter = scopedOrganizationWhere(currentUser);

  const [invites, gminas, organizations, currentUserOrganization] = await Promise.all([
    // Invites created before organizationId existed on this model won't
    // match a coordinator's scoped filter — see POST /api/admin/invites.
    organizationFilter === null
      ? Promise.resolve([])
      : prisma.inviteToken.findMany({
          where: organizationFilter,
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
    // Only ADMIN picks/creates a gmina and organization when inviting; a
    // coordinator's invite always goes to their own organization, so they
    // never need either full list.
    isAdmin
      ? prisma.gmina.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    isAdmin
      ? prisma.organization.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, gminaId: true } })
      : Promise.resolve([]),
    !isAdmin && currentUser.organizationId
      ? prisma.organization.findUnique({ where: { id: currentUser.organizationId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      {/* Covers both this page's own invite list AND its gmina/organization
          picker (server-rendered above) — either kind of change re-runs the
          whole RSC fetch via router.refresh(). */}
      <AdminEventsRefresh scope={['invites', 'gminas', 'organizations']} />
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Zaproszenia</h1>
        <p className="text-sm text-slate-500 mt-1">
          {isAdmin
            ? 'Zapraszaj nowe osoby do systemu i zarządzaj statusem wysłanych zaproszeń.'
            : 'Zapraszaj wolontariuszy do swojej organizacji i zarządzaj statusem wysłanych zaproszeń.'}
        </p>
      </div>

      <div className="max-w-xl">
        <CreateInviteForm
          gminas={gminas}
          organizations={organizations}
          isAdmin={isAdmin}
          currentUserOrganizationId={currentUser.organizationId}
          currentUserOrganizationName={currentUserOrganization?.name ?? null}
        />
      </div>

      <div className="min-w-0 bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-1 text-slate-500">
          <Send className="h-4 w-4" />
          <h2 className="text-xs font-extrabold uppercase tracking-wider">Wysłane zaproszenia</h2>
        </div>
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
              {invites.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 px-4 text-center text-slate-400">
                    Brak wysłanych zaproszeń.
                  </td>
                </tr>
              )}
              {invites.map((invite) => {
                const status: InviteStatus = invite.usedAt
                  ? 'Wykorzystane'
                  : invite.revokedAt
                  ? 'Unieważnione'
                  : invite.expiresAt.getTime() < Date.now()
                  ? 'Wygasłe'
                  : 'Aktywne';
                const canAct = isAdmin || invite.createdById === userId;
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
                    <td className="py-3 px-4 text-right">
                      {canAct && <ToggleInviteButton inviteId={invite.id} status={status} />}
                    </td>
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
