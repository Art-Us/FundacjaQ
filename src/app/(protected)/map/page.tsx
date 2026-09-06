import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import type { Role } from '@/types';
import AlertsMapView from './AlertsMapView';

export default async function MapPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/login');
  }

  const role = session.user.role as Role;
  const gminaId = session.user.gminaId;

  const isGminaScoped = role !== 'ADMIN';
  const gminaFilter = isGminaScoped && gminaId ? { gminaId } : {};
  const canManageAlerts = role === 'ADMIN' || role === 'COORDINATOR';

  const [alerts, gminy] = await Promise.all([
    prisma.alert.findMany({
      where: gminaFilter,
      include: { gmina: true },
      orderBy: { createdAt: 'desc' },
    }),
    // ADMIN musi móc wybrać gminę przy tworzeniu alertu; COORDINATOR i tak jest
    // ograniczony do własnej gminy po stronie API, ale lista ułatwia mu wybór z
    // dokładną nazwą zamiast wpisywania id ręcznie.
    prisma.gmina.findMany({ orderBy: { name: 'asc' } }),
  ]);

  return (
    <AlertsMapView
      initialAlerts={alerts}
      gminy={gminy}
      canManageAlerts={canManageAlerts}
      currentUserGminaId={gminaId}
      currentUserRole={role}
    />
  );
}
