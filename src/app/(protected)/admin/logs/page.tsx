import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isGlobalAdmin } from '@/lib/authz';
import { LogsTabs } from './LogsTabs';

export default async function AdminLogsPage() {
  const session = await getSession();
  // ADMIN-only (COORDINATOR is deliberately left out) — a global admin sees
  // every gmina's audit log AND login attempts; a gmina-scoped admin sees
  // (and may revert) only their own gmina's audit log, but never login
  // attempts (see the "Logowania" tab gating below, and GET
  // /api/admin/login-attempts, which stays global-admin-only).
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/');
  }

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dziennik zdarzeń</h1>
        <p className="text-sm text-slate-500 mt-1">
          Zmiany w panelu administracyjnym, logowania, rejestracje i zmiany hasła.
        </p>
      </div>

      <LogsTabs canSeeLoginAttempts={isGlobalAdmin(session.user)} />
    </main>
  );
}
