import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator, isAllocationDonor, isAllocationRecipient, isAdminForGmina } from '@/lib/authz';

export const runtime = 'nodejs';

const createMessageSchema = z.object({
  body: z.string().trim().min(1, 'Wiadomość nie może być pusta.').max(2000),
});

async function findAllocationWithAlert(id: string) {
  return prisma.resourceAllocation.findUnique({
    where: { id },
    include: { alert: { select: { id: true, gminaId: true, organizationId: true } } },
  });
}

// Narrow, "working" chat between the two organizations actually involved in
// ONE allocation — donor, recipient, or ADMIN (нюанс #8,
// docs/are-you-familiar-with-tidy-blum.md; a gmina-scoped ADMIN only within
// their own gmina, isAdminForGmina). A COORDINATOR from an unrelated third
// organization has no business reading this: it's deliberately narrower
// than the broad, alert-wide AlertMessage forum (R12/Крок 50), which every
// involved org can see.
function canAccessAllocationMessages(
  allocation: { donorOrgId: string; alert: { gminaId: string; organizationId: string | null } },
  user: { role: string; organizationId?: string | null; gminaId?: string | null }
): boolean {
  return isAdminForGmina(user, allocation.alert.gminaId) || isAllocationDonor(allocation, user) || isAllocationRecipient(allocation, user);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const allocation = await findAllocationWithAlert(params.id);
  if (!allocation) {
    return NextResponse.json({ error: 'Przydział nie istnieje.' }, { status: 404 });
  }
  if (!canAccessAllocationMessages(allocation, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tej korespondencji.' }, { status: 403 });
  }

  const messages = await prisma.allocationMessage.findMany({
    where: { allocationId: allocation.id },
    include: { author: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const allocation = await findAllocationWithAlert(params.id);
  if (!allocation) {
    return NextResponse.json({ error: 'Przydział nie istnieje.' }, { status: 404 });
  }
  if (!canAccessAllocationMessages(allocation, user)) {
    return NextResponse.json({ error: 'Nie masz uprawnień do tej korespondencji.' }, { status: 403 });
  }

  const parsed = createMessageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }

  let message;
  try {
    message = await prisma.allocationMessage.create({
      data: { allocationId: allocation.id, authorId: user.id, body: parsed.data.body },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  } catch {
    return NextResponse.json({ error: 'Nie udało się wysłać wiadomości.' }, { status: 500 });
  }

  return NextResponse.json({ message }, { status: 201 });
}
