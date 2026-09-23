import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { alertInclude } from '@/lib/alertInclude';
import type { Role } from '@/types';
import AlertsMapView from './AlertsMapView';

export default async function MapPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/login');
  }

  const role = session.user.role as Role;
  const gminaId = session.user.gminaId;

  const canManageAlerts = role === 'ADMIN' || role === 'COORDINATOR';

  const [alerts, gminy, myResources] = await Promise.all([
    // Every logged-in user sees every alert, in every gmina — a crisis
    // doesn't stop at a gmina border, and gmina-scoping here used to hide
    // alerts from everyone outside the (easy to mis-pick) gmina they were
    // filed under.
    prisma.alert.findMany({
      // Everything fetched here lands in AlertsMapView's props, i.e. in
      // the RSC payload of this page — alertInclude (lib/alertInclude.ts)
      // is the allowlist of what's safe to send to the browser.
      include: alertInclude,
      orderBy: { createdAt: 'desc' },
    }),
    // ADMIN musi móc wybrać gminę przy tworzeniu alertu; COORDINATOR i tak jest
    // ograniczony do własnej gminy po stronie API, ale lista ułatwia mu wybór z
    // dokładną nazwą zamiast wpisywania id ręcznie.
    // Only what the gmina picker/map centring needs (GminaOption) — no
    // contactEmail/contactPhone, which would otherwise ride along into the
    // client payload for every visitor of /map.
    prisma.gmina.findMany({
      select: { id: true, name: true, latitude: true, longitude: true },
      orderBy: { name: 'asc' },
    }),
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
