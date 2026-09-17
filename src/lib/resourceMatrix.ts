import { prisma } from '@/lib/prisma';

export const MATRIX_HORIZONS = ['H24', 'H48', 'H72', 'WEEK'] as const;
export type MatrixHorizon = (typeof MATRIX_HORIZONS)[number];

export const MATRIX_GROUPS = ['PEOPLE', 'WATER', 'EQUIPMENT', 'OTHER'] as const;
export type MatrixGroup = (typeof MATRIX_GROUPS)[number];

export interface MatrixCell {
  quantity: number;
  reservedQuantity: number;
  available: number;
}

export interface MatrixCategoryRow {
  categoryId: string;
  name: string;
  group: MatrixGroup;
  horizons: Record<MatrixHorizon, MatrixCell>;
}

export interface MatrixTile {
  group: MatrixGroup;
  quantity: number;
  reservedQuantity: number;
  available: number;
  within24h: number;
}

export function emptyMatrixTiles(groups: readonly MatrixGroup[] = MATRIX_GROUPS): MatrixTile[] {
  return groups.map((group) => ({ group, quantity: 0, reservedQuantity: 0, available: 0, within24h: 0 }));
}

export interface ComputeResourceMatrixParams {
  /** `{}` for ADMIN or `{gminaId}` for a gmina-scoped role — see scopedGminaWhere (lib/gmina.ts). Callers must resolve the fail-closed `null` case themselves before calling this. */
  gminaFilter: Record<string, unknown>;
  organizationId?: string;
  group?: MatrixGroup;
}

/**
 * The "Matryca Zasobów w Czasie" aggregation (R10) — shared by
 * GET /api/resources/matrix (Крок 20, for the client's "Odśwież" refetch) and
 * the /zasoby server page (Крок 31, for the first paint) so the cumulative
 * horizon math lives in exactly one place.
 */
export async function computeResourceMatrix({
  gminaFilter,
  organizationId,
  group,
}: ComputeResourceMatrixParams): Promise<{ tiles: MatrixTile[]; categories: MatrixCategoryRow[] }> {
  const tileGroups = group ? [group] : MATRIX_GROUPS;

  const [categories, grouped] = await Promise.all([
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
  function cumulativeCell(categoryId: string, uptoIndex: number): MatrixCell {
    let quantity = 0;
    let reservedQuantity = 0;
    for (let i = 0; i <= uptoIndex; i++) {
      const entry = sumsByKey.get(`${categoryId}|${MATRIX_HORIZONS[i]}`);
      if (entry) {
        quantity += entry.quantity;
        reservedQuantity += entry.reservedQuantity;
      }
    }
    return { quantity, reservedQuantity, available: Math.max(quantity - reservedQuantity, 0) };
  }

  const categoryRows: MatrixCategoryRow[] = categories.map((category) => {
    const horizons = {} as Record<MatrixHorizon, MatrixCell>;
    MATRIX_HORIZONS.forEach((horizon, idx) => {
      horizons[horizon] = cumulativeCell(category.id, idx);
    });
    return { categoryId: category.id, name: category.name, group: category.group as MatrixGroup, horizons };
  });

  // Each tile's main figure is the group's grand total (the WEEK column,
  // which cumulatively includes every horizon); "within24h" is the same
  // group's H24 column, shown as the tile's secondary figure (fot. 1).
  const tiles: MatrixTile[] = tileGroups.map((tileGroup) => {
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

  return { tiles, categories: categoryRows };
}
