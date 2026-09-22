import { NextResponse } from 'next/server';
import { requireGlobalAdmin } from '@/lib/authz';
import { getGminaLocationOptions } from '@/lib/gmina';

export const runtime = 'nodejs';

// Split out from GET /api/admin/gminas on purpose — see getGminaLocationOptions'
// doc comment: these options only change on a gmina create/edit/delete, not on
// every search/sort/page-turn against the list, so the frontend fetches this
// once on mount and again only after a mutation, instead of on every list request.
// Global-admin-only, same as the rest of gmina management.
export async function GET() {
  const admin = await requireGlobalAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const locations = await getGminaLocationOptions();
  return NextResponse.json({ locations });
}
