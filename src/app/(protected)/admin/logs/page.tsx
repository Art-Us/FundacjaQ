import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { AuditLogDirectory } from './AuditLogDirectory';

export default async function AdminLogsPage() {
  const session = await getSession();
  // ADMIN-only for now — see the note in api/admin/logs/route.ts on why
  // COORDINATOR isn't given even a gmina-scoped view yet.
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/');
  }

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dziennik zdarzeń</h1>
        <p className="text-sm text-slate-500 mt-1">
          Kto, co i kiedy zmienił w panelu administracyjnym — z możliwością cofnięcia zmiany.
        </p>
      </div>

      <AuditLogDirectory />
    </main>
  );
}
