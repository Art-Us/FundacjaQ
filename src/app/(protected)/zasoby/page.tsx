import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { scopedGminaWhere } from '@/lib/gmina';
import { computeResourceMatrix, emptyMatrixTiles } from '@/lib/resourceMatrix';
import { fetchAllocationInbox } from '@/lib/allocationInbox';
import { RefreshOnMount } from '@/components/RefreshOnMount';
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

  // Must fail closed (see scopedGminaWhere's doc comment) — a COORDINATOR
  // with no gmina of their own sees an empty matrix/organization list, never
  // the unfiltered {} that would hand them every gmina's resources.
  const gminaFilter = scopedGminaWhere({ role, gminaId });

  const [matrix, organizations, inbox] = await Promise.all([
    gminaFilter === null ? Promise.resolve({ tiles: emptyMatrixTiles(), categories: [] }) : computeResourceMatrix({ gminaFilter }),
    gminaFilter === null
      ? Promise.resolve([])
      : prisma.organization.findMany({ where: gminaFilter, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    fetchAllocationInbox(organizationId),
  ]);

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <RefreshOnMount />
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Matryca Zasobów Ratunkowych</h1>
        <p className="text-sm text-slate-500 mt-1">
          Przegląd zasobów organizacji w podziale na kategorie i horyzonty czasowe dostępności.
        </p>
      </div>

      <AllocationInboxPanel recipient={inbox.recipient} donor={inbox.donor} />

      <ResourceMatrixView initialTiles={matrix.tiles} initialCategories={matrix.categories} organizations={organizations} />
    </main>
  );
}
