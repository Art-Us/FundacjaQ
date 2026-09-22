import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { isGlobalAdmin } from '@/lib/authz';
import { scopedGminaWhere } from '@/lib/gmina';
import { OrganizationsDirectory } from './OrganizationsDirectory';
import { AdminEventsRefresh } from '@/components/AdminEventsRefresh';

export default async function AdminOrganizationsPage() {
  const session = await getSession();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/');
  }

  // Gmina creation (POST /api/admin/gminas) is global-admin-only — a
  // gmina-scoped admin never gets "+ Nowa gmina…" in this page's create/edit
  // forms, even though they can otherwise fully manage their own gmina's
  // organizations.
  const canCreateGmina = isGlobalAdmin(session.user);

  // A gmina-scoped admin's picker/filter cascade only ever offers their own
  // gmina — same fail-closed contract as everywhere else gmina scoping
  // applies. Gmina itself has no gminaId column (its own id IS the gmina),
  // so the { gminaId } shape scopedGminaWhere returns needs translating to
  // { id } before it can filter the Gmina table directly.
  const gminaFilter = scopedGminaWhere(session.user);
  const gminaIdFilter = gminaFilter && 'gminaId' in gminaFilter ? { id: gminaFilter.gminaId } : {};

  // Full gmina list (now scoped), needed by the create/edit form's gmina
  // picker AND by the directory's voivodeship/powiat/gmina filter cascade —
  // not the (paginated) organizations list itself, which
  // OrganizationsDirectory fetches from the server on its own.
  const gminas =
    gminaFilter === null
      ? []
      : await prisma.gmina.findMany({
          where: gminaIdFilter,
          orderBy: { name: 'asc' },
          select: { id: true, name: true, powiat: true, voivodeship: true },
        });

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      {/* The organizations list refreshes itself (OrganizationsDirectory
          listens for 'organizations' events client-side) — this only covers
          the gmina picker above, fetched here on the server. */}
      <AdminEventsRefresh scope="gminas" />
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Organizacje</h1>
        <p className="text-sm text-slate-500 mt-1">Przeglądaj, twórz i zarządzaj organizacjami w systemie.</p>
      </div>

      <OrganizationsDirectory gminas={gminas} canCreateGmina={canCreateGmina} />
    </main>
  );
}
