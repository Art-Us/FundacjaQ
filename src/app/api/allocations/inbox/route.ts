import { NextResponse } from 'next/server';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { fetchAllocationInbox } from '@/lib/allocationInbox';

export const runtime = 'nodejs';

export async function GET() {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  try {
    const inbox = await fetchAllocationInbox(user.organizationId);
    return NextResponse.json(inbox);
  } catch (err) {
    console.error('[allocations] inbox failed:', err);
    return NextResponse.json({ error: 'Nie udało się pobrać listy zwrotów.' }, { status: 500 });
  }
}
