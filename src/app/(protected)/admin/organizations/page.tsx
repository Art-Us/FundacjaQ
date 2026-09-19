import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { OrganizationsDirectory } from './OrganizationsDirectory';

export default async function AdminOrganizationsPage() {
  const session = await getSession();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/');
  }

  // Full gmina list, needed by the create/edit form's gmina picker — not the
  // (paginated) organizations list itself, which OrganizationsDirectory fetches
  // from the server on its own.
  const gminas = await prisma.gmina.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Organizacje</h1>
        <p className="text-sm text-slate-500 mt-1">Przeglądaj, twórz i zarządzaj organizacjami w systemie.</p>
      </div>

      <OrganizationsDirectory gminas={gminas} />
    </main>
  );
}
