import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser, canPostAlertJournalEntry, canViewAlertJournal } from '@/lib/authz';
import { ALERT_MESSAGE_TYPES } from '@/lib/alertMessageLabels';
import { getCachedAlertAccess, setCachedAlertAccess, type CachedAlertAccess } from '@/lib/alertAccessCache';

export const runtime = 'nodejs';

const createEntrySchema = z.object({
  type: z.enum(ALERT_MESSAGE_TYPES),
  title: z.string().trim().min(1, 'Tytuł wpisu jest wymagany.').max(200),
  body: z.string().trim().min(1, 'Treść wpisu nie może być pusta.').max(4000),
});

// Redis-fast-path/Postgres-fallback for the alert lookup below — this route
// only ever needs gminaId to authorize the request (canViewAlertJournal),
// never the rest of the alert record (see alertAccessCache.ts's doc comment).
async function findAlert(id: string): Promise<CachedAlertAccess | null> {
  const cached = await getCachedAlertAccess(id);
  if (cached) return cached;

  const alert = await prisma.alert.findUnique({
    where: { id },
    select: { gminaId: true, organizationId: true, status: true },
  });
  if (!alert) return null;

  await setCachedAlertAccess(id, alert);
  return alert;
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
    where: { alertId: params.id, parentId: null },
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
        alertId: params.id,
        authorId: user.id,
        authorOrgId: user.organizationId ?? null,
        type: parsed.data.type,
        title: parsed.data.title,
        body: parsed.data.body,
      },
      include: { author: { select: { id: true, name: true } } },
    });
  } catch (err) {
    // The alert lookup above can come from the cache (findAlert) and go
    // stale if the alert was deleted right after its cache entry was last
    // written — alertId's foreign key is the real, live source of truth, so
    // that specific failure means "alert doesn't exist" (404), not a generic
    // server error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Nie udało się dodać wpisu.' }, { status: 500 });
  }

  return NextResponse.json({ entry }, { status: 201 });
}
