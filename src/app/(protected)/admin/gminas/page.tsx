import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isGlobalAdmin } from '@/lib/authz';
import { GminasDirectory } from './GminasDirectory';

export default async function AdminGminasPage() {
  const session = await getSession();
  // Global-admin-only — a gmina-scoped admin has no access to gmina
  // management at all (see the matching gate in the /api/admin/gminas
  // routes and the "Gminy" nav link in Sidebar.tsx).
  if (!session?.user || !isGlobalAdmin(session.user)) {
    redirect('/');
  }

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Gminy</h1>
        <p className="text-sm text-slate-500 mt-1">Przeglądaj, twórz i zarządzaj gminami w systemie.</p>
      </div>

      <GminasDirectory />
    </main>
  );
}
