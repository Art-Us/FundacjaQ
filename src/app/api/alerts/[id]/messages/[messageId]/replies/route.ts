import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser, canViewAlertJournal, canReplyToAlertForum } from '@/lib/authz';

export const runtime = 'nodejs';

const createReplySchema = z.object({
  body: z.string().trim().min(1, 'Wiadomość nie może być pusta.').max(2000),
});

// Includes `allocations` (donor orgs) alongside the plain fields
// canViewAlertJournal needs — canReplyToAlertForum (POST guard below) needs
// the fuller shape.
async function findAlert(id: string) {
  return prisma.alert.findUnique({
    where: { id },
    select: {
      id: true,
      gminaId: true,
      organizationId: true,
      allocations: { select: { donorOrgId: true } },
    },
  });
}

// A reply's parent must be a root entry ("wpis", parentId = null) of THIS
// alert — prevents replying under a message from a different alert, or
// nesting a reply under another reply (only one level deep, per the
// prototype: root entries + a flat chat thread each, no sub-threads).
async function findRootEntry(alertId: string, messageId: string) {
  return prisma.alertMessage.findFirst({
    where: { id: messageId, alertId, parentId: null },
    select: { id: true },
  });
}

// GET — the chat thread under one root journal entry. Same visibility as the
// entry list itself (Крок 53): anyone who can see the alert, VOLUNTEER
// included.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; messageId: string } }
) {
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

  const rootEntry = await findRootEntry(alert.id, params.messageId);
  if (!rootEntry) {
    return NextResponse.json({ error: 'Wpis nie istnieje.' }, { status: 404 });
  }

  const replies = await prisma.alertMessage.findMany({
    where: { parentId: rootEntry.id },
    include: { author: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ replies });
}

// POST — a chat reply under a root entry. Broader access than creating the
// entry itself (Крок 53's POST): the alert's owner org, any donor org, or
// ADMIN/COORDINATOR (canReplyToAlertForum, Крок 52) — the same "everyone
// involved" group the original flat-forum design (R12) allowed to write.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; messageId: string } }
) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const alert = await findAlert(params.id);
  if (!alert) {
    return NextResponse.json({ error: 'Alert nie istnieje.' }, { status: 404 });
  }
  if (!canReplyToAlertForum(alert, user)) {
    return NextResponse.json(
      { error: 'Nie masz uprawnień do odpowiadania w tym wątku.' },
      { status: 403 }
    );
  }

  const rootEntry = await findRootEntry(alert.id, params.messageId);
  if (!rootEntry) {
    return NextResponse.json({ error: 'Wpis nie istnieje.' }, { status: 404 });
  }

  const parsed = createReplySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  let reply;
  try {
    reply = await prisma.alertMessage.create({
      data: {
        alertId: alert.id,
        parentId: rootEntry.id,
        authorId: user.id,
        authorOrgId: user.organizationId ?? null,
        body: parsed.data.body,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się wysłać wiadomości.' }, { status: 500 });
  }

  return NextResponse.json({ reply }, { status: 201 });
}
