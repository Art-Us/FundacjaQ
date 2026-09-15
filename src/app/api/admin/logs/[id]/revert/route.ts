import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { revertAuditLog, requestMeta } from '@/lib/auditLog';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const result = await revertAuditLog(params.id, admin, requestMeta(req));
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
