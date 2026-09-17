import { NextResponse } from 'next/server';
import type { AlertStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';

export const runtime = 'nodejs';

const CLOSED_ALERT_STATUSES: AlertStatus[] = ['CANCELLED', 'RESOLVED'];

// R7's derived "needs action" inbox — there's no Notification model in this
// system (see docs/are-you-familiar-with-tidy-blum.md §5), so this is just a
// query for "what does MY organization still owe a decision on", split into
// two sections the UI (AllocationInboxPanel, Крок 36) renders differently:
// `recipient` gets a "Zwróć zasoby" button per row (only the recipient acts —
// decision #3), `donor` is informational only.
export async function GET() {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ recipient: [], donor: [] });
  }

  const include = {
    returnEvents: true,
    alert: { select: { id: true, title: true, status: true } },
    category: { select: { id: true, name: true, group: true } },
  } as const;

  const [recipient, donor] = await Promise.all([
    prisma.resourceAllocation.findMany({
      where: {
        alert: { organizationId: user.organizationId, status: { in: CLOSED_ALERT_STATUSES } },
        status: { notIn: ['RETURNED', 'CANCELLED'] },
      },
      include,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.resourceAllocation.findMany({
      where: {
        donorOrgId: user.organizationId,
        alert: { status: { in: CLOSED_ALERT_STATUSES } },
        status: { notIn: ['RETURNED', 'CANCELLED'] },
      },
      include,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({ recipient, donor });
}
