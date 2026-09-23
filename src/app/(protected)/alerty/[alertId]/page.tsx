import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building, Calendar, MapPin, MessageSquare, User } from 'lucide-react';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { alertInclude } from '@/lib/alertInclude';
import { canReplyToAlertForum, canPostAlertJournalEntry, isAlertOwnerOrg } from '@/lib/authz';
import { availableCategoryIds } from '@/lib/resourceMatching';
import { ALERT_STATUS_LABELS, ALERT_CATEGORY_LABELS, SEVERITY_LABELS, getSeverityBadgeInfo } from '@/lib/alertLabels';
import { formatDate } from '@/lib/utils';
import AlertNeedsBlock from '../../map/AlertNeedsBlock';
import AlertDetailMap from './AlertDetailMap';
import AlertOperationalJournal from './AlertOperationalJournal';

// Full alert-details subpage (R12, docs/resource_management_plan.md Крок 55):
// top-to-bottom — alert card + map, resource needs, and the operational
// journal/forum (Крок 56). Reached via the "Forum" icon on the alert's card
// (Крок 58).
export default async function AlertDetailPage({ params }: { params: { alertId: string } }) {
  const session = await getSession();
  if (!session?.user) {
    redirect('/login');
  }
  const currentUser = session.user;

  // Same allowlisted shape as the /map list (lib/alertInclude.ts) — the author
  // is narrowed to name + organization name before it ever reaches the client
  // below, but the query itself must not pull passwordHash & co. either.
  const alert = await prisma.alert.findUnique({
    where: { id: params.alertId },
    include: alertInclude,
  });

  // Every logged-in user may see every alert (same as the /map list).
  if (!alert) {
    redirect('/map');
  }

  const [entries, myResources] = await Promise.all([
    prisma.alertMessage.findMany({
      where: { alertId: alert.id, parentId: null },
      include: {
        author: { select: { id: true, name: true } },
        _count: { select: { replies: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    currentUser.organizationId
      ? prisma.resource.findMany({
          where: { organizationId: currentUser.organizationId },
          select: { categoryId: true, quantity: true, reservedQuantity: true },
        })
      : Promise.resolve([]),
  ]);

  const canManageAlerts = currentUser.role === 'ADMIN' || currentUser.role === 'COORDINATOR';
  // Same rule as AlertsMapView.tsx's canManageNeedsForAlert — owner org (or
  // ADMIN) only, mirrored server-side by PATCH/DELETE /api/needs/[id].
  const canManageNeeds = canManageAlerts && (currentUser.role === 'ADMIN' || isAlertOwnerOrg(alert, currentUser));
  const canAllocate = canManageAlerts && !!currentUser.organizationId;
  const ownedCategoryIds = availableCategoryIds(myResources);
  // Same flattening AlertsMapView.tsx uses for openAllocationCount — every
  // allocation on the alert lives under one of its needs, not directly on
  // Alert.allocations in this fetch (Крок 55 never included that relation).
  const allAllocations = alert.needs.flatMap((need) => need.allocations);
  const canReplyToJournal = canReplyToAlertForum({ organizationId: alert.organizationId, allocations: allAllocations }, currentUser);
  const canPostJournalEntry = canPostAlertJournalEntry(currentUser);

  const isEventView = alert.kind === 'EVENT';
  const severityInfo = getSeverityBadgeInfo(alert.severity);

  return (
    <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-16 pb-10 lg:pt-8 max-w-7xl w-full mx-auto space-y-6">
      <Link
        href="/map"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Powrót do mapy
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="rounded-3xl bg-white p-6 shadow-xs border border-slate-200 space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {!isEventView && (
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-xs font-extrabold border uppercase tracking-wider ${severityInfo.badgeClass}`}
              >
                <span className={`h-2 w-2 rounded-full ${severityInfo.dotClass}`} />
                {SEVERITY_LABELS[alert.severity] ?? alert.severity}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider">
              {ALERT_CATEGORY_LABELS[alert.category] ?? alert.category}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-700 text-xs font-bold uppercase tracking-wider">
              {ALERT_STATUS_LABELS[alert.status] ?? alert.status}
            </span>
          </div>

          <div className="space-y-1.5">
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug tracking-tight">
              {alert.title}
            </h1>
            <p className="text-sm text-slate-600 font-medium leading-relaxed">{alert.description}</p>
          </div>

          <div className="flex flex-col gap-1.5 text-xs text-slate-500 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <span>
                {alert.gmina.name}
                {alert.location ? ` · ${alert.location}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Building className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>{alert.author?.organization?.name || alert.gmina.name}</span>
            </div>
            {alert.author?.name && (
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>{alert.author.name}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <time>{formatDate(alert.createdAt)}</time>
            </div>
          </div>
        </div>

        <AlertDetailMap
          kind={alert.kind as 'ALERT' | 'EVENT'}
          alert={{
            id: alert.id,
            title: alert.title,
            description: alert.description,
            kind: alert.kind,
            severity: alert.severity,
            status: alert.status,
            category: alert.category,
            location: alert.location,
            latitude: alert.latitude,
            longitude: alert.longitude,
            createdAt: alert.createdAt,
            startsAt: alert.startsAt,
            expiresAt: alert.expiresAt,
            gmina: { name: alert.gmina.name },
            author: alert.author
              ? { name: alert.author.name, organization: alert.author.organization }
              : null,
            needs: alert.needs.map((need) => ({
              id: need.id,
              title: need.title,
              quantityNeeded: need.quantityNeeded,
              quantityFulfilled: need.quantityFulfilled,
              unit: need.unit,
              urgency: need.urgency,
            })),
          }}
        />
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-xs border border-slate-200">
        <AlertNeedsBlock
          alertId={alert.id}
          alertLocationLabel={alert.location || alert.gmina.name}
          alertDescription={alert.description}
          alertStatus={alert.status}
          needs={alert.needs.map((need) => ({
            ...need,
            allocations: need.allocations.map((allocation) => ({
              id: allocation.id,
              quantity: allocation.quantity,
              unit: allocation.unit,
              status: allocation.status,
              donorOrgId: allocation.donorOrgId,
              donorOrgName: allocation.donorOrg.name,
              createdByName: allocation.createdBy?.name ?? null,
              createdAt: allocation.createdAt,
            })),
          }))}
          canManageNeeds={canManageNeeds}
          canAllocate={canAllocate}
          currentUserRole={currentUser.role}
          currentUserOrganizationId={currentUser.organizationId}
          alertOrganizationId={alert.organizationId}
          ownedCategoryIds={ownedCategoryIds}
        />
      </div>

      {/* Dziennik operacyjny & forum komunikatu (Крок 56) — Крок 57 adds
          "+ Stwórz nowy wpis" on top of this list. */}
      <section className="rounded-3xl bg-white p-6 shadow-xs border border-slate-200 space-y-4">
        <div className="flex items-center gap-1.5 text-slate-700">
          <MessageSquare className="h-4 w-4" />
          <h2 className="text-sm font-bold">Dziennik operacyjny i forum komunikatu ({alert._count.messages})</h2>
        </div>

        <AlertOperationalJournal
          alertId={alert.id}
          entries={entries}
          canReply={canReplyToJournal}
          canPost={canPostJournalEntry}
        />
      </section>
    </main>
  );
}
