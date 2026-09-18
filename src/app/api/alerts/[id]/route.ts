import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAlertOwnerOrg, canManageAlert } from '@/lib/authz';
import { ALERT_CATEGORIES, EVENT_CATEGORIES, isCategoryValidForKind } from '@/lib/alertLabels';
import type { AlertKindValue } from '@/lib/alertLabels';

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
  expiresAt: z.coerce.date().nullable().optional(),
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

  await prisma.alert.update({ where: { id: alert.id }, data: parsed.data });

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

  await prisma.alert.delete({ where: { id: alert.id } });

  return NextResponse.json({ message: 'Alert usunięty.' });
}
