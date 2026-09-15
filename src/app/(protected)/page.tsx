import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck, UserPlus, BellRing, Building2, Users } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getDashboardData } from '@/lib/dashboard';
import { formatDate } from '@/lib/utils';
import { SEVERITY_STYLES, ALERT_STATUS_LABELS } from '@/lib/alertLabels';
import { ROLE_LABELS } from '@/lib/roleLabels';
import type { Role } from '@/types';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  COORDINATOR: 'Koordynator gminny',
  VOLUNTEER: 'Wolontariusz',
};

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-rose-50 text-rose-700 border-rose-200',
  HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-slate-100 text-slate-700 border-slate-200',
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
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-8">
      <div className="rounded-3xl bg-white p-6 sm:p-8 border border-slate-200/80 shadow-xs relative overflow-hidden">
        <div className="relative z-10 max-w-2xl space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Zakres danych: {data.scopeLabel}</span>
          </div>
          <p className="text-slate-500 text-xs sm:text-sm">Witaj, {session.user.name ?? session.user.email}</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Panel — {ROLE_LABELS[role] ?? role}
          </h1>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Aktywne alerty" value={data.stats.activeAlerts} icon={<BellRing className="h-4 w-4" />} />
        <StatCard label="Gminy w systemie" value={data.stats.gminyCount} icon={<Building2 className="h-4 w-4" />} />
        <StatCard
          label={role === 'ADMIN' ? 'Użytkownicy' : 'Użytkownicy w gminie'}
          value={data.stats.usersCount}
          icon={<Users className="h-4 w-4" />}
        />
      </div>

      {data.canManageInvites && (
        <div className="rounded-3xl border border-slate-200/80 bg-white shadow-xs p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <p className="text-slate-900 font-bold text-sm">Zarządzanie zaproszeniami</p>
              <p className="text-xs text-slate-500">Zaproś nowe osoby do systemu i przypisz im rolę.</p>
            </div>
          </div>
          <Link
            href="/admin/invites"
            className="shrink-0 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-5 py-2.5 shadow-sm shadow-indigo-600/25 transition text-center"
          >
            Otwórz panel zaproszeń
          </Link>
        </div>
      )}

      <div className="space-y-8">
        <section className="space-y-4 min-w-0">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Alerty</h2>
          {data.alerts.length === 0 ? (
            <div className="rounded-3xl bg-white p-8 text-center border border-slate-200/80 shadow-xs">
              <p className="text-xs text-slate-500">Brak alertów do wyświetlenia.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`rounded-2xl border px-4 py-3 shadow-xs ${SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.LOW}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-sm">{alert.title}</p>
                    <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">
                      {ALERT_STATUS_LABELS[alert.status] ?? alert.status}
                    </span>
                  </div>
                  <p className="text-xs opacity-80 mt-1">{alert.description}</p>
                  <p className="text-[11px] opacity-60 mt-2">
                    {alert.gmina.name}
                    {alert.location ? ` · ${alert.location}` : ''} · {formatDate(alert.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4 min-w-0">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Zasoby</h2>
          {data.resources.length === 0 ? (
            <div className="rounded-3xl bg-white p-8 text-center border border-slate-200/80 shadow-xs">
              <p className="text-xs text-slate-500">Brak zasobów do wyświetlenia.</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 border-b border-slate-200/80 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3 px-4">Nazwa</th>
                      <th className="py-3 px-4">Kategoria</th>
                      <th className="py-3 px-4">Ilość</th>
                      <th className="py-3 px-4">Status</th>
                      {role === 'ADMIN' && <th className="py-3 px-4">Gmina</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.resources.map((resource) => (
                      <tr key={resource.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3 px-4 font-semibold text-slate-800">{resource.name}</td>
                        <td className="py-3 px-4 text-slate-600">{resource.category.name}</td>
                        <td className="py-3 px-4 text-slate-600">
                          {resource.quantity} {resource.unit}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{RESOURCE_STATUS_LABELS[resource.status] ?? resource.status}</td>
                        {role === 'ADMIN' && <td className="py-3 px-4 text-slate-600">{resource.gmina.name}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs p-4 flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 font-semibold">{label}</p>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
}
