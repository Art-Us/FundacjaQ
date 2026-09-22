import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser, canPostAlertJournalEntry, canViewAlertJournal } from '@/lib/authz';
import { ALERT_MESSAGE_TYPES } from '@/lib/alertMessageLabels';

export const runtime = 'nodejs';

const createEntrySchema = z.object({
  type: z.enum(ALERT_MESSAGE_TYPES),
  title: z.string().trim().min(1, 'Tytuł wpisu jest wymagany.').max(200),
  body: z.string().trim().min(1, 'Treść wpisu nie może być pusta.').max(4000),
});

async function findAlert(id: string) {
  return prisma.alert.findUnique({
    where: { id },
    select: { id: true, gminaId: true, organizationId: true },
  });
}

// GET — the list of root journal entries ("wpisy") under an alert. Anyone
// who can see the alert can read this (including VOLUNTEER); only creating a
// new one (POST below) is restricted to ADMIN/COORDINATOR.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await findAlert(params.id);
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }
  if (!canViewAlertJournal(alert, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do przeglądania tego alertu.' }, { status: 403 });
  }

  const entries = await prisma.alertMessage.findMany({
    where: { alertId: alert.id, parentId: null },
    include: {
      author: { select: { id: true, name: true } },
      _count: { select: { replies: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ entries });
}

// POST — a new root entry ("wpis"). Only ADMIN/COORDINATOR run the journal
// (canPostAlertJournalEntry, Крок 52); replying under an existing entry is a
// separate, broader-access endpoint (Крок 54,
// /api/alerts/[id]/messages/[messageId]/replies).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await findAlert(params.id);
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }
  if (!canPostAlertJournalEntry(user)) {
    return NextResponse.json(
      { error: 'Tylko administrator lub koordynator może dodawać wpisy do dziennika operacyjnego.' },
      { status: 403 }
    );
  }
  if (!canViewAlertJournal(alert, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tego alertu.' }, { status: 403 });
  }

  const parsed = createEntrySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  let entry;
  try {
    entry = await prisma.alertMessage.create({
      data: {
        alertId: alert.id,
        authorId: user.id,
        authorOrgId: user.organizationId ?? null,
        type: parsed.data.type,
        title: parsed.data.title,
        body: parsed.data.body,
      },
      include: { author: { select: { id: true, name: true } } },
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się dodać wpisu.' }, { status: 500 });
  }

  return NextResponse.json({ entry }, { status: 201 });
}
