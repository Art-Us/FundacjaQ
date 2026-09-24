import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAdminForGmina } from '@/lib/authz';
import { ALERT_CATEGORIES, EVENT_CATEGORIES, isCategoryValidForKind } from '@/lib/alertLabels';
import { publishAdminEvent } from '@/lib/adminEvents';

export const runtime = 'nodejs';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const KINDS = ['ALERT', 'EVENT'] as const;
// `as const` jest tu istotne: zachowuje literały, więc z.enum() daje union
// zgodny z enumem AlertCategory Prismy (bez tego byłby zwykły `string`).
const ALL_CATEGORIES = [...ALERT_CATEGORIES, ...EVENT_CATEGORIES] as const;

const createAlertSchema = z.object({
  title: z.string().min(1, 'Tytuł jest wymagany.').max(200),
  description: z.string().min(1, 'Opis jest wymagany.').max(2000),
  kind: z.enum(KINDS).default('ALERT'),
  // Zdarzenia codzienne nie mają krytyczności — API przyjmuje ją opcjonalnie i
  // zapisuje wartość domyślną, żeby jedna tabela obsłużyła oba rodzaje wpisów.
  severity: z.enum(SEVERITIES).default('MEDIUM'),
  category: z.enum(ALL_CATEGORIES).default('GENERAL'),
  location: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  gminaId: z.string().min(1, 'Gmina jest wymagana.'),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
}).refine((data) => !data.startsAt || !data.expiresAt || data.startsAt <= data.expiresAt, {
  message: 'Data rozpoczęcia nie może być późniejsza niż data zakończenia.',
  path: ['startsAt'],
});

export async function POST(req: NextRequest) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = createAlertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const { gminaId, ...data } = parsed.data;

  // Kategoria i rodzaj wpisu muszą do siebie pasować — bez tego dałoby się
  // zapisać festyn z kategorią "Zagrożenie pożarowe" i zniknąłby on z widoku
  // zdarzeń, bo filtr kategorii w UI zna tylko podzbiór właściwy dla kind.
  if (!isCategoryValidForKind(data.category, data.kind)) {
    return NextResponse.json(
      { error: 'Wybrana kategoria nie należy do tego rodzaju wpisu.' },
      { status: 400 }
    );
  }

  // A global ADMIN may create for any gmina; COORDINATOR and a gmina-scoped
  // ADMIN only for their own (isAdminForGmina).
  if (!isAdminForGmina(user, gminaId) && gminaId !== user.gminaId) {
    return NextResponse.json({ error: 'Możesz tworzyć alerty tylko dla swojej gminy.' }, { status: 403 });
  }

  const gmina = await prisma.gmina.findUnique({ where: { id: gminaId } });
  if (!gmina) {
    return NextResponse.json({ error: 'Gmina nie istnieje.' }, { status: 400 });
  }

  // Крок 30 — fixed at creation from the author's own organization and never
  // changed afterwards (see the Alert.organizationId comment in
  // schema.prisma); a user with no organization (e.g. a site-wide ADMIN)
  // simply produces an ownerless alert, same as this field's backfill
  // migration leaves pre-existing alerts whose author had no organization.
  let alert;
  try {
    alert = await prisma.alert.create({
      data: { ...data, gminaId, authorId: user.id, organizationId: user.organizationId ?? null },
    });
  } catch (err) {
    console.error('[alerts] create failed:', err);
    return NextResponse.json({ error: 'Nie udało się utworzyć alertu.' }, { status: 500 });
  }

  await publishAdminEvent({ scope: 'alerts', gminaId });

  return NextResponse.json({ message: 'Alert utworzony.', alert });
}
