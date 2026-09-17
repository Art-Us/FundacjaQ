import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { scopedGminaWhere } from '@/lib/gmina';
import { computeResourceMatrix, emptyMatrixTiles, MATRIX_GROUPS } from '@/lib/resourceMatrix';

export const runtime = 'nodejs';

const matrixQuerySchema = z.object({
  organizationId: z.string().optional(),
  group: z.enum(MATRIX_GROUPS).optional(),
});

export async function GET(req: NextRequest) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const parsed = matrixQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe parametry filtrowania.' }, { status: 400 });
  }
  const { organizationId, group } = parsed.data;
  const tileGroups = group ? [group] : MATRIX_GROUPS;

  // Must fail closed (see scopedGminaWhere's doc comment) — a gmina-scoped
  // role with no gmina gets an empty matrix, never the unfiltered {} that
  // would hand them every gmina's resources.
  const gminaFilter = scopedGminaWhere(user);
  if (gminaFilter === null) {
    return NextResponse.json({ tiles: emptyMatrixTiles(tileGroups), categories: [] });
  }

  let result;
  try {
    result = await computeResourceMatrix({ gminaFilter, organizationId, group });
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać macierzy zasobów.' }, { status: 500 });
  }

  return NextResponse.json(result);
}
