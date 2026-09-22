import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { scopedGminaWhereAnyAdmin } from '@/lib/gmina';
import type { Role } from '@/types';
import AlertsMapView from './AlertsMapView';

export default async function MapPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/login');
  }

  const role = session.user.role as Role;
  const gminaId = session.user.gminaId;

  // Alerts stay ADMIN-unconditional — see scopedGminaWhereAnyAdmin's doc
  // comment. Must still fail closed for a gmina-scoped role with no gmina.
  const gminaFilter = scopedGminaWhereAnyAdmin({ role, gminaId });
  const canManageAlerts = role === 'ADMIN' || role === 'COORDINATOR';

  const [alerts, gminy] = await Promise.all([
    gminaFilter === null
      ? Promise.resolve([])
      : prisma.alert.findMany({
          where: gminaFilter,
          include: { gmina: true, author: { include: { organization: true } } },
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
