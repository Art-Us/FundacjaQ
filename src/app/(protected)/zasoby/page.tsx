import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { scopedGminaWhere } from '@/lib/gmina';
import { isGlobalAdmin } from '@/lib/authz';
import { computeResourceMatrix, emptyMatrixTiles } from '@/lib/resourceMatrix';
import { fetchAllocationInbox } from '@/lib/allocationInbox';
import { RefreshOnMount } from '@/components/RefreshOnMount';
import { AppEventsRefresh } from '@/components/AppEventsRefresh';
import ResourceMatrixView from './ResourceMatrixView';
import AllocationInboxPanel from './AllocationInboxPanel';

// "Жорстке обмеження доступу" (розділ 4, docs/are-you-familiar-with-tidy-blum.md)
// — this whole module is ADMIN/COORDINATOR only, same as every other admin
// section. Enforced here on the server regardless of whether the "Zasoby"
// nav item is even rendered for the caller (Крок 38) — hiding a menu item is
// never the real access control.
export default async function ZasobyPage() {
  const session = await getSession();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'COORDINATOR')) {
    redirect('/');
  }

  const { role, gminaId, organizationId } = session.user;

  // A gmina-scoped ADMIN sees only their own gmina's resource matrix and
  // organizations picker, same as COORDINATOR — a global ADMIN (gminaId ===
  // null) still sees every gmina's. Must fail closed for a gmina-scoped
  // role with no gmina.
  const gminaFilter = scopedGminaWhere({ role, gminaId });
  // undefined (not gminaId) for a global admin — see AppEventsRefresh's own
  // doc comment for why that's what "react to every gmina" means there.
  const eventGminaId = isGlobalAdmin({ role, gminaId }) ? undefined : gminaId;

  const [matrix, organizations, inbox] = await Promise.all([
    gminaFilter === null
      ? Promise.resolve({ tiles: emptyMatrixTiles(), categories: [] })
      : computeResourceMatrix({ gminaFilter }),
    gminaFilter === null
      ? Promise.resolve([])
      : prisma.organization.findMany({ where: gminaFilter, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    fetchAllocationInbox(organizationId),
  ]);

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <RefreshOnMount />
      <AppEventsRefresh scope="resources" gminaId={eventGminaId} />

      <AllocationInboxPanel recipient={inbox.recipient} donor={inbox.donor} />

      <ResourceMatrixView
        initialTiles={matrix.tiles}
        initialCategories={matrix.categories}
        organizations={organizations}
        currentUserOrganizationId={organizationId ?? null}
        isAdmin={role === 'ADMIN'}
        viewerGminaId={eventGminaId}
      />
    </main>
  );
}
