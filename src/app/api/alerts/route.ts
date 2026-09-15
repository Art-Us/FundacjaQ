import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { ALERT_CATEGORIES, EVENT_CATEGORIES, isCategoryValidForKind } from '@/lib/alertLabels';

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
  expiresAt: z.coerce.date().optional(),
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

  // COORDINATOR może tworzyć alerty tylko dla swojej gminy; ADMIN dla dowolnej.
  if (user.role !== 'ADMIN' && gminaId !== user.gminaId) {
    return NextResponse.json({ error: 'Możesz tworzyć alerty tylko dla swojej gminy.' }, { status: 403 });
  }

  const gmina = await prisma.gmina.findUnique({ where: { id: gminaId } });
  if (!gmina) {
    return NextResponse.json({ error: 'Gmina nie istnieje.' }, { status: 400 });
  }

  const alert = await prisma.alert.create({
    data: { ...data, gminaId, authorId: user.id },
  });

  return NextResponse.json({ message: 'Alert utworzony.', alert });
}
