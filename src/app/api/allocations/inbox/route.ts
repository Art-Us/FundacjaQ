import { NextResponse } from 'next/server';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { fetchAllocationInbox } from '@/lib/allocationInbox';

export const runtime = 'nodejs';

export async function GET() {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const inbox = await fetchAllocationInbox(user.organizationId);
  return NextResponse.json(inbox);
}
