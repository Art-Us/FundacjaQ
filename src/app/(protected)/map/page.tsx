import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { scopedGminaWhere } from '@/lib/gmina';
import type { Role } from '@/types';
import AlertsMapView from './AlertsMapView';

export default async function MapPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/login');
  }

  const role = session.user.role as Role;
  const gminaId = session.user.gminaId;

  // Must fail closed (see scopedGminaWhere's doc comment) — a gmina-scoped
  // role with no gmina gets nothing, never the unfiltered {} that would hand
  // them every gmina's alerts.
  const gminaFilter = scopedGminaWhere({ role, gminaId });
  const canManageAlerts = role === 'ADMIN' || role === 'COORDINATOR';

  const [alerts, gminy, myResources] = await Promise.all([
    gminaFilter === null
      ? Promise.resolve([])
      : prisma.alert.findMany({
          where: gminaFilter,
          include: {
            gmina: true,
            author: { include: { organization: true } },
            needs: {
              include: {
                allocations: {
                  include: {
                    donorOrg: { select: { id: true, name: true } },
                    createdBy: { select: { id: true, name: true } },
                  },
                },
              },
            },
            // Total journal entries + replies (Крок 58) — feeds the "Forum"
            // icon badge on each card, independent of AlertNeedsBlock (which
            // renders nothing at all when there are no needs).
            _count: { select: { messages: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
    // ADMIN musi móc wybrać gminę przy tworzeniu alertu; COORDINATOR i tak jest
    // ograniczony do własnej gminy po stronie API, ale lista ułatwia mu wybór z
    // dokładną nazwą zamiast wpisywania id ręcznie.
    prisma.gmina.findMany({ orderBy: { name: 'asc' } }),
    // Own organization's resources — feeds the "Masz zasoby (N)" badge (R11,
    // Крок 43): which of an alert's still-open needs fall in a category this
    // org currently has something free to give in (lib/resourceMatching.ts).
    // An ADMIN with no organization of their own simply never matches anything.
    session.user.organizationId
      ? prisma.resource.findMany({
          where: { organizationId: session.user.organizationId },
          select: { categoryId: true, quantity: true, reservedQuantity: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <AlertsMapView
      initialAlerts={alerts}
      gminy={gminy}
      canManageAlerts={canManageAlerts}
      currentUserGminaId={gminaId}
      currentUserRole={role}
      currentUserId={session.user.id}
      currentUserOrganizationId={session.user.organizationId}
      myResources={myResources}
    />
  );
}
