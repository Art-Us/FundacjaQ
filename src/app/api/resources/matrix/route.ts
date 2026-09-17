import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { scopedGminaWhere } from '@/lib/gmina';

export const runtime = 'nodejs';

const HORIZONS = ['H24', 'H48', 'H72', 'WEEK'] as const;
type Horizon = (typeof HORIZONS)[number];

const GROUPS = ['PEOPLE', 'WATER', 'EQUIPMENT', 'OTHER'] as const;
type Group = (typeof GROUPS)[number];

const matrixQuerySchema = z.object({
  organizationId: z.string().optional(),
  group: z.enum(GROUPS).optional(),
});

interface Cell {
  quantity: number;
  reservedQuantity: number;
  available: number;
}

function emptyTiles(groups: readonly Group[]) {
  return groups.map((group) => ({ group, quantity: 0, reservedQuantity: 0, available: 0, within24h: 0 }));
}

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
  const tileGroups = group ? [group] : GROUPS;

  // Must fail closed (see scopedGminaWhere's doc comment) — a gmina-scoped
  // role with no gmina gets an empty matrix, never the unfiltered {} that
  // would hand them every gmina's resources.
  const gminaFilter = scopedGminaWhere(user);
  if (gminaFilter === null) {
    return NextResponse.json({ tiles: emptyTiles(tileGroups), categories: [] });
  }

  let categories, grouped;
  try {
    [categories, grouped] = await Promise.all([
      prisma.resourceCategory.findMany({
        where: group ? { group } : undefined,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, group: true },
      }),
      prisma.resource.groupBy({
        by: ['categoryId', 'horizon'],
        where: {
          ...gminaFilter,
          ...(organizationId ? { organizationId } : {}),
          ...(group ? { category: { group } } : {}),
        },
        _sum: { quantity: true, reservedQuantity: true },
      }),
    ]);
  } catch {
    return NextResponse.json({ error: 'Nie udało się pobrać macierzy zasobów.' }, { status: 500 });
  }

  const sumsByKey = new Map<string, { quantity: number; reservedQuantity: number }>();
  for (const row of grouped) {
    sumsByKey.set(`${row.categoryId}|${row.horizon}`, {
      quantity: row._sum.quantity ?? 0,
      reservedQuantity: row._sum.reservedQuantity ?? 0,
    });
  }

  // Horizon is cumulative (decision #2, docs/are-you-familiar-with-tidy-blum.md):
  // a resource available within H24 also counts toward the H48/H72/WEEK
  // columns, since anything available sooner is by definition also available
  // by any later deadline.
  function cumulativeCell(categoryId: string, uptoIndex: number): Cell {
    let quantity = 0;
    let reservedQuantity = 0;
    for (let i = 0; i <= uptoIndex; i++) {
      const entry = sumsByKey.get(`${categoryId}|${HORIZONS[i]}`);
      if (entry) {
        quantity += entry.quantity;
        reservedQuantity += entry.reservedQuantity;
      }
    }
    return { quantity, reservedQuantity, available: Math.max(quantity - reservedQuantity, 0) };
  }

  const categoryRows = categories.map((category) => {
    const horizons = {} as Record<Horizon, Cell>;
    HORIZONS.forEach((horizon, idx) => {
      horizons[horizon] = cumulativeCell(category.id, idx);
    });
    return { categoryId: category.id, name: category.name, group: category.group as Group, horizons };
  });

  // Each tile's main figure is the group's grand total (the WEEK column,
  // which cumulatively includes every horizon); "within24h" is the same
  // group's H24 column, shown as the tile's secondary figure (fot. 1).
  const tiles = tileGroups.map((tileGroup) => {
    const rows = categoryRows.filter((row) => row.group === tileGroup);
    return rows.reduce(
      (acc, row) => ({
        group: tileGroup,
        quantity: acc.quantity + row.horizons.WEEK.quantity,
        reservedQuantity: acc.reservedQuantity + row.horizons.WEEK.reservedQuantity,
        available: acc.available + row.horizons.WEEK.available,
        within24h: acc.within24h + row.horizons.H24.quantity,
      }),
      { group: tileGroup, quantity: 0, reservedQuantity: 0, available: 0, within24h: 0 }
    );
  });

  return NextResponse.json({ tiles, categories: categoryRows });
}
