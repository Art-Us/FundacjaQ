import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAlertOwnerOrg, canManageAlert, isAdminForGmina } from '@/lib/authz';
import { ALERT_CATEGORIES, EVENT_CATEGORIES, isCategoryValidForKind } from '@/lib/alertLabels';
import type { AlertKindValue } from '@/lib/alertLabels';
import { recalculateNeedFulfillment } from '@/lib/allocations';
import { invalidateAlertAccessCache } from '@/lib/alertAccessCache';
import { publishAdminEvent } from '@/lib/adminEvents';

export const runtime = 'nodejs';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const ALERT_STATUSES = ['ACTIVE', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
// `as const` jest tu istotne: zachowuje literały, więc z.enum() daje union
// zgodny z enumem AlertCategory Prismy (bez tego byłby zwykły `string`).
const ALL_CATEGORIES = [...ALERT_CATEGORIES, ...EVENT_CATEGORIES] as const;

// `kind` celowo nie jest edytowalny: alert i zdarzenie codzienne mają rozłączne
// zestawy kategorii, więc zmiana rodzaju w miejscu zostawiłaby wpis z kategorią
// z innego zestawu.
const updateAlertSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(ALERT_STATUSES).optional(),
  category: z.enum(ALL_CATEGORIES).optional(),
  location: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
}).refine((data) => !data.startsAt || !data.expiresAt || data.startsAt <= data.expiresAt, {
  message: 'Data rozpoczęcia nie może być późniejsza niż data zakończenia.',
  path: ['startsAt'],
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await prisma.alert.findUnique({ where: { id: params.id } });
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }

  // ADMIN może edytować dowolny alert; COORDINATOR tylko ten, który należy do
  // jego własnej organizacji (canManageAlert, lib/resourceAuthz.ts) — ta sama
  // reguła, którą karta alertu stosuje po stronie klienta do pokazania
  // przycisków "Edytuj"/"Rozwiąż"/"Odwołaj".
  if (!canManageAlert(alert, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do edycji tego alertu.' }, { status: 403 });
  }

  const parsed = updateAlertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Brak zmian do zapisania.' }, { status: 400 });
  }

  if (parsed.data.category && !isCategoryValidForKind(parsed.data.category, alert.kind as AlertKindValue)) {
    return NextResponse.json(
      { error: 'Wybrana kategoria nie należy do tego rodzaju wpisu.' },
      { status: 400 }
    );
  }

  // Крок 29 — the OWNER organization can't cancel straight through here once
  // it has resources in flight; it must go through cancel-with-return
  // (Крок 28) so every received resource gets a return decision first. This
  // deliberately does NOT apply to an ADMIN cancelling another org's alert
  // (нюанс #5, docs/are-you-familiar-with-tidy-blum.md §7) — that stays this
  // simple path, with the recipient settling remaining allocations
  // afterwards via the /zasoby inbox (Крок 27) instead.
  if (parsed.data.status === 'CANCELLED' && alert.status !== 'CANCELLED' && isAlertOwnerOrg(alert, user)) {
    const activeAllocationsCount = await prisma.resourceAllocation.count({
      where: { alertId: alert.id, status: { notIn: ['RETURNED', 'CANCELLED'] } },
    });
    if (activeAllocationsCount > 0) {
      return NextResponse.json(
        {
          error: 'Masz aktywne przydziały zasobów — anuluj ten alert przez formularz zwrotu zasobów.',
          code: 'USE_CANCEL_WITH_RETURN',
        },
        { status: 409 }
      );
    }
  }

  // "Wznów komunikat"/"Przywróć wydarzenie" (AlertActions.tsx) brings a
  // CANCELLED/RESOLVED alert back to ACTIVE through this same plain PATCH —
  // but cancel-with-return (Крок 28) had permanently set every one of that
  // alert's needs to CLOSED when it was cancelled. Left alone, a reactivated
  // alert looks perfectly normal (0/N, 0%) while every one of its needs is
  // silently unreachable forever: PATCH /api/needs/[id] only allows a manual
  // status of CLOSED/CANCELLED, never back to OPEN (Крок 22), and "Przydziel
  // zasoby" only renders for a need whose status isn't FULFILLED/CLOSED/
  // CANCELLED (AlertNeedsBlock.tsx) — no donor can ever offer anything again.
  // CLOSED is reachable ONLY through that cancel-with-return sweep today (no
  // UI path PATCHes a need straight to CLOSED), so every CLOSED need found
  // here is safe to reopen — there's no other reason one could be in that
  // state on an alert that's ACTIVE again.
  const reactivating = parsed.data.status === 'ACTIVE' && alert.status !== 'ACTIVE';

  try {
    if (reactivating) {
      await prisma.$transaction(async (tx) => {
        const closedNeeds = await tx.alertNeed.findMany({
          where: { alertId: alert.id, status: 'CLOSED' },
          select: { id: true, quantityNeeded: true },
        });
        for (const need of closedNeeds) {
          const needAllocations = await tx.resourceAllocation.findMany({
            where: { needId: need.id },
            select: { status: true, quantity: true },
          });
          // 'OPEN' here is a placeholder, not the need's real prior status —
          // it exists only to reach recalculateNeedFulfillment's general
          // formula. That function's own early return for a CLOSED/CANCELLED
          // need protects a deliberate closure from being silently reopened
          // by an unrelated caller; reopening on reactivation is precisely
          // the one place that guard needs to be bypassed.
          const { quantityFulfilled, status } = recalculateNeedFulfillment(need.quantityNeeded, needAllocations, 'OPEN');
          await tx.alertNeed.update({ where: { id: need.id }, data: { quantityFulfilled, status } });
        }
        await tx.alert.update({ where: { id: alert.id }, data: parsed.data });
      });
    } else {
      await prisma.alert.update({ where: { id: alert.id }, data: parsed.data });
    }
  } catch (err) {
    console.error('[alerts] update failed:', err);
    return NextResponse.json({ error: 'Nie udało się zaktualizować alertu.' }, { status: 500 });
  }

  // Only alert-access-cache-relevant field that can ever change here — see
  // alertAccessCache.ts's doc comment (gminaId/organizationId are immutable).
  if (parsed.data.status) {
    await invalidateAlertAccessCache(alert.id);
  }

  await publishAdminEvent({ scope: 'alerts', gminaId: alert.gminaId });

  return NextResponse.json({ message: 'Alert zaktualizowany.' });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  // Usuwanie na twardo tylko dla ADMIN — COORDINATOR może co najwyżej zmienić
  // status na RESOLVED/CANCELLED (PATCH powyżej), zgodnie z zasadą zachowania
  // historii zdarzeń zamiast ich kasowania.
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Tylko administrator może trwale usunąć alert.' }, { status: 403 });
  }

  const alert = await prisma.alert.findUnique({ where: { id: params.id } });
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }

  // A gmina-scoped admin may only hard-delete alerts in their own gmina — a
  // global admin (gminaId === null) is unrestricted.
  if (!isAdminForGmina(user, alert.gminaId)) {
    return NextResponse.json({ error: 'Możesz usuwać tylko alerty ze swojej gminy.' }, { status: 403 });
  }

  try {
    // Alert -> AlertNeed -> ResourceAllocation cascade on delete, but nothing
    // releases the reservation those allocations hold on Resource.reservedQuantity
    // — without this, a deleted alert permanently strands reservedQuantity on
    // the donor's resource (wrong "dostępne" in the matrix forever, and
    // DELETE /api/resources/[id] refuses to ever delete that resource again).
    await prisma.$transaction(async (tx) => {
      const active = await tx.resourceAllocation.findMany({
        where: { alertId: alert.id, status: { notIn: ['RETURNED', 'CANCELLED'] }, resourceId: { not: null } },
        select: { resourceId: true, quantity: true, quantityReturned: true, quantityNotReturnable: true },
      });
      for (const a of active) {
        const outstanding = a.quantity - a.quantityReturned - a.quantityNotReturnable;
        if (outstanding > 0) {
          await tx.resource.update({
            where: { id: a.resourceId! },
            data: { reservedQuantity: { decrement: outstanding } },
          });
        }
      }
      await tx.alert.delete({ where: { id: alert.id } });
    });
  } catch (err) {
    console.error('[alerts] delete failed:', err);
    return NextResponse.json({ error: 'Nie udało się usunąć alertu.' }, { status: 500 });
  }

  await invalidateAlertAccessCache(alert.id);
  // Also touches 'resources': the transaction above released every active
  // allocation's reserved quantity back onto its donor's resource — no
  // gminaId on that one, since those donors can span more than one gmina
  // (crisis response crosses gmina boundaries, same as donating in the
  // first place) and a single event can only ever name one. Run
  // concurrently — publishAdminEvent never rejects, so there's nothing a
  // sequential await here would protect against, only latency it'd add.
  await Promise.all([
    publishAdminEvent({ scope: 'alerts', gminaId: alert.gminaId }),
    publishAdminEvent({ scope: 'resources' }),
  ]);

  return NextResponse.json({ message: 'Alert usunięty.' });
}
