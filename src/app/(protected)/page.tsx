import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getDashboardData } from '@/lib/dashboard';
import { formatDate } from '@/lib/utils';
import type { Role } from '@/types';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  COORDINATOR: 'Koordynator gminny',
  VOLUNTEER: 'Wolontariusz',
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-rose-950 text-rose-300 border-rose-800',
  HIGH: 'bg-orange-950 text-orange-300 border-orange-800',
  MEDIUM: 'bg-amber-950 text-amber-300 border-amber-800',
  LOW: 'bg-slate-800 text-slate-300 border-slate-700',
};

const ALERT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktywny',
  IN_PROGRESS: 'W trakcie',
  RESOLVED: 'Rozwiązany',
  CANCELLED: 'Anulowany',
};

const RESOURCE_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Dostępny',
  RESERVED: 'Zarezerwowany',
  IN_USE: 'W użyciu',
  DEPLETED: 'Wyczerpany',
};

export default async function HomePage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/login');
  }

  const { role, gminaId } = session.user;
  const data = await getDashboardData(role as Role, gminaId);

  return (
    <main className="flex-1 px-4 py-10 container mx-auto">
      <div className="mb-8">
        <p className="text-sm text-slate-500">Witaj, {session.user.name ?? session.user.email}</p>
        <h1 className="text-2xl font-bold text-slate-100">
          Panel — {ROLE_LABELS[role] ?? role}
        </h1>
        <p className="text-sm text-slate-500 mt-1">Zakres danych: {data.scopeLabel}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-10">
        <StatCard label="Aktywne alerty" value={data.stats.activeAlerts} />
        <StatCard label="Gminy w systemie" value={data.stats.gminyCount} />
        <StatCard label={role === 'ADMIN' ? 'Użytkownicy' : 'Użytkownicy w gminie'} value={data.stats.usersCount} />
      </div>

      {data.canManageInvites && (
        <div className="mb-10 rounded-xl border border-slate-800 bg-slate-900/50 p-4 flex items-center justify-between">
          <div>
            <p className="text-slate-100 font-medium">Zarządzanie zaproszeniami</p>
            <p className="text-sm text-slate-500">Zaproś nowe osoby do systemu i przypisz im rolę.</p>
          </div>
          <Link
            href="/admin/invites"
            className="shrink-0 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            Otwórz panel zaproszeń
          </Link>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Alerty</h2>
          {data.alerts.length === 0 ? (
            <p className="text-sm text-slate-500">Brak alertów do wyświetlenia.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`rounded-lg border px-4 py-3 ${SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.LOW}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{alert.title}</p>
                    <span className="text-xs uppercase tracking-wide opacity-80">
                      {ALERT_STATUS_LABELS[alert.status] ?? alert.status}
                    </span>
                  </div>
                  <p className="text-sm opacity-80 mt-1">{alert.description}</p>
                  <p className="text-xs opacity-60 mt-2">
                    {alert.gmina.name}
                    {alert.location ? ` · ${alert.location}` : ''} · {formatDate(alert.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Zasoby</h2>
          {data.resources.length === 0 ? (
            <p className="text-sm text-slate-500">Brak zasobów do wyświetlenia.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-slate-300">
                <thead className="text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-4">Nazwa</th>
                    <th className="py-2 pr-4">Kategoria</th>
                    <th className="py-2 pr-4">Ilość</th>
                    <th className="py-2 pr-4">Status</th>
                    {role === 'ADMIN' && <th className="py-2 pr-4">Gmina</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.resources.map((resource) => (
                    <tr key={resource.id} className="border-b border-slate-900">
                      <td className="py-2 pr-4">{resource.name}</td>
                      <td className="py-2 pr-4">{resource.category.name}</td>
                      <td className="py-2 pr-4">
                        {resource.quantity} {resource.unit}
                      </td>
                      <td className="py-2 pr-4">{RESOURCE_STATUS_LABELS[resource.status] ?? resource.status}</td>
                      {role === 'ADMIN' && <td className="py-2 pr-4">{resource.gmina.name}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-3xl font-bold text-slate-100 mt-1">{value}</p>
    </div>
  );
}
