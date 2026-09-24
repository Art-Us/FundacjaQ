import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/authz';
import type { ScopeChangeNotice } from '@/lib/scopeChangeNotice';

export const runtime = 'nodejs';

/**
 * Lets any signed-in user read their own pending "you were moved to a
 * different organization/gmina" notice (see the doc comment on
 * User.pendingScopeChangeNotice in schema.prisma) — polled once on mount by
 * components/layout/ScopeChangeNoticeModal.tsx and re-polled whenever a
 * 'user-notice' SSE event arrives for this user.
 */
export async function GET() {
  const actor = await requireUser();
  if (!actor) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { pendingScopeChangeNotice: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'Użytkownik nie istnieje.' }, { status: 404 });
  }

  return NextResponse.json({ notice: (user.pendingScopeChangeNotice as ScopeChangeNotice | null) ?? null });
}

/** Dismisses the caller's own pending notice — called once they've clicked "OK" on the modal, never automatically. */
export async function DELETE() {
  const actor = await requireUser();
  if (!actor) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: actor.id },
    data: { pendingScopeChangeNotice: Prisma.JsonNull },
  });

  return NextResponse.json({ ok: true });
}
