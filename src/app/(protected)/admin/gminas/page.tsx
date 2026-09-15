import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { RefreshOnMount } from '@/components/RefreshOnMount';
import { GminasDirectory } from './GminasDirectory';
import type { GminaListItem } from './types';

export default async function AdminGminasPage() {
  const session = await getSession();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/');
  }

  const gminas = await prisma.gmina.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { users: true, resources: true, alerts: true, inviteTokens: true, organizations: true } },
    },
  });

  const items: GminaListItem[] = gminas.map((gmina) => ({
    id: gmina.id,
    name: gmina.name,
    powiat: gmina.powiat,
    voivodeship: gmina.voivodeship,
    latitude: gmina.latitude,
    longitude: gmina.longitude,
    usersCount: gmina._count.users,
    resourcesCount: gmina._count.resources,
    alertsCount: gmina._count.alerts,
    inviteTokensCount: gmina._count.inviteTokens,
    organizationsCount: gmina._count.organizations,
  }));

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <RefreshOnMount />
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Gminy</h1>
        <p className="text-sm text-slate-500 mt-1">Przeglądaj, twórz i zarządzaj gminami w systemie.</p>
      </div>

      <GminasDirectory gminas={items} />
    </main>
  );
}
