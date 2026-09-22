import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, isGminaScopedAdmin } from '@/lib/authz';
import { revertAuditLog, requestMeta } from '@/lib/auditLog';

export const runtime = 'nodejs';

// ADMIN-only, same as GET /api/admin/logs. A global admin may revert any
// entry. A gmina-scoped admin may only revert one whose OWN gminaId matches
// theirs — checked up front here for a quick, clean error — AND the whole
// cascade chain revertAuditLog walks is re-checked inside it (via
// restrictToGminaId), since a cascade can reach entries beyond the one
// requested (see that function's own doc comment for why the target-only
// check here isn't sufficient by itself).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  if (isGminaScopedAdmin(admin)) {
    const target = await prisma.auditLog.findUnique({ where: { id: params.id }, select: { gminaId: true } });
    if (!target) {
      return NextResponse.json({ error: 'Wpis dziennika nie istnieje.' }, { status: 404 });
    }
    if (target.gminaId !== admin.gminaId) {
      return NextResponse.json({ error: 'Nie masz uprawnień do cofnięcia tej zmiany.' }, { status: 403 });
    }
  }

  const result = await revertAuditLog(
    params.id,
    admin,
    requestMeta(req),
    isGminaScopedAdmin(admin) ? admin.gminaId! : undefined
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // More than one when this cascaded through later, still-active changes to
  // the same record to reach the requested point in its history.
  const message =
    result.revertedLogIds.length > 1
      ? `Cofnięto ${result.revertedLogIds.length} zmian.`
      : 'Zmiana została cofnięta.';

  return NextResponse.json({ message, revertedLogIds: result.revertedLogIds });
}
