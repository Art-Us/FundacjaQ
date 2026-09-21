import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdminOrCoordinator: vi.fn() };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { GET } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;
// resource.groupBy's real Prisma type is a heavily overloaded generic
// (conditional on `by`/`orderBy`/`_sum`/...) — DeepMockProxy's mapped type
// can't unify that with a mock function signature, so TS exposes the plain
// method type instead of one with `mockResolvedValue`. It IS mocked at
// runtime (mockReset(prisma) resets it like every other method); this is a
// one-time cast so the tests below don't each need their own `as any`.
const groupByMock = prisma.resource.groupBy as unknown as Mock;

function makeRequest(query = '') {
  return new NextRequest(`http://localhost/api/resources/matrix${query}`);
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('GET /api/resources/matrix', () => {
  it('returns 403 with no DB call when the caller is not ADMIN/COORDINATOR', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    expect(prisma.resource.groupBy).not.toHaveBeenCalled();
  });

  it('returns an empty (fail-closed) matrix for a gmina-scoped role with no gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: null });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.categories).toEqual([]);
    expect(body.tiles).toHaveLength(4);
    expect(body.tiles.every((t: any) => t.quantity === 0)).toBe(true);
    expect(prisma.resource.groupBy).not.toHaveBeenCalled();
  });

  it('rejects an invalid group filter', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await GET(makeRequest('?group=NOT_A_GROUP'));

    expect(res.status).toBe(400);
  });

  it('restricts tiles to a single group when the group filter is set', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resourceCategory.findMany.mockResolvedValue([]);
    groupByMock.mockResolvedValue([]);

    const res = await GET(makeRequest('?group=WATER'));
    const body = await res.json();

    expect(body.tiles).toEqual([{ group: 'WATER', quantity: 0, reservedQuantity: 0, available: 0, within24h: 0 }]);
  });

  it('builds cumulative horizon columns and per-group tiles', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resourceCategory.findMany.mockResolvedValue([
      { id: 'cat-water', name: 'Woda pitna', group: 'WATER' },
      { id: 'cat-eq', name: 'Sprzęt medyczny', group: 'EQUIPMENT' },
    ] as any);
    groupByMock.mockResolvedValue([
      { categoryId: 'cat-water', horizon: 'H24', _sum: { quantity: 10, reservedQuantity: 4 } },
      { categoryId: 'cat-water', horizon: 'H72', _sum: { quantity: 5, reservedQuantity: 0 } },
      { categoryId: 'cat-eq', horizon: 'WEEK', _sum: { quantity: 3, reservedQuantity: 1 } },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    const water = body.categories.find((c: any) => c.categoryId === 'cat-water');
    // H24 column: just the H24 row.
    expect(water.horizons.H24).toEqual({ quantity: 10, reservedQuantity: 4, available: 6 });
    // H48 column: still just H24 (nothing declared at H48 itself), cumulative.
    expect(water.horizons.H48).toEqual({ quantity: 10, reservedQuantity: 4, available: 6 });
    // H72 column: H24 + H72 rows combined.
    expect(water.horizons.H72).toEqual({ quantity: 15, reservedQuantity: 4, available: 11 });
    // WEEK column: same as H72 (nothing declared at WEEK itself).
    expect(water.horizons.WEEK).toEqual({ quantity: 15, reservedQuantity: 4, available: 11 });

    const eq = body.categories.find((c: any) => c.categoryId === 'cat-eq');
    expect(eq.horizons.H24).toEqual({ quantity: 0, reservedQuantity: 0, available: 0 });
    expect(eq.horizons.WEEK).toEqual({ quantity: 3, reservedQuantity: 1, available: 2 });

    const waterTile = body.tiles.find((t: any) => t.group === 'WATER');
    expect(waterTile).toEqual({ group: 'WATER', quantity: 15, reservedQuantity: 4, available: 11, within24h: 10 });
    const eqTile = body.tiles.find((t: any) => t.group === 'EQUIPMENT');
    expect(eqTile).toEqual({ group: 'EQUIPMENT', quantity: 3, reservedQuantity: 1, available: 2, within24h: 0 });
  });

  it('passes organizationId and group filters through to the groupBy query', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1' });
    prisma.resourceCategory.findMany.mockResolvedValue([]);
    groupByMock.mockResolvedValue([]);

    await GET(makeRequest('?organizationId=o1&group=WATER'));

    expect(prisma.resource.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ gminaId: 'g1', organizationId: 'o1', category: { group: 'WATER' } }),
      })
    );
  });
});
