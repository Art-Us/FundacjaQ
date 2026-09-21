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
 * the /zasoby server page (Крок 31, for the first paint) so the horizon
 * bucketing math lives in exactly one place.
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

  // Each horizon column shows only what was declared at exactly that
  // horizon — a resource declared "H72" does NOT also count toward the WEEK
  // column, even though 72h fits inside a week. Buckets are mutually
  // exclusive, so summing across all four gives the group's true grand total.
  function exactCell(categoryId: string, horizon: MatrixHorizon): MatrixCell {
    const entry = sumsByKey.get(`${categoryId}|${horizon}`);
    const quantity = entry?.quantity ?? 0;
    const reservedQuantity = entry?.reservedQuantity ?? 0;
    return { quantity, reservedQuantity, available: Math.max(quantity - reservedQuantity, 0) };
  }

  const categoryRows: MatrixCategoryRow[] = categories.map((category) => {
    const horizons = {} as Record<MatrixHorizon, MatrixCell>;
    MATRIX_HORIZONS.forEach((horizon) => {
      horizons[horizon] = exactCell(category.id, horizon);
    });
    return { categoryId: category.id, name: category.name, group: category.group as MatrixGroup, horizons };
  });

  // Each tile's main figure is the group's grand total across all four
  // (now mutually exclusive) horizon buckets combined; "within24h" is just
  // the H24 bucket, shown as the tile's secondary figure (fot. 1).
  const tiles: MatrixTile[] = tileGroups.map((tileGroup) => {
    const rows = categoryRows.filter((row) => row.group === tileGroup);
    return rows.reduce(
      (acc, row) => {
        const rowTotal = MATRIX_HORIZONS.reduce(
          (sum, h) => ({
            quantity: sum.quantity + row.horizons[h].quantity,
            reservedQuantity: sum.reservedQuantity + row.horizons[h].reservedQuantity,
            available: sum.available + row.horizons[h].available,
          }),
          { quantity: 0, reservedQuantity: 0, available: 0 }
        );
        return {
          group: tileGroup,
          quantity: acc.quantity + rowTotal.quantity,
          reservedQuantity: acc.reservedQuantity + rowTotal.reservedQuantity,
          available: acc.available + rowTotal.available,
          within24h: acc.within24h + row.horizons.H24.quantity,
        };
      },
      { group: tileGroup, quantity: 0, reservedQuantity: 0, available: 0, within24h: 0 }
    );
  });

  return { tiles, categories: categoryRows };
}
