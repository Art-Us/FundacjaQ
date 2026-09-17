import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return {
    ...actual,
    requireAdmin: vi.fn(),
  };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { GET } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/gminas/locations', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(prisma.gmina.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty list when no gmina has a voivodeship set', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findMany.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.locations).toEqual([]);
    expect(prisma.gmina.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { voivodeship: { not: null } }, distinct: ['voivodeship', 'powiat'] })
    );
  });

  it('groups powiats under every voivodeship they appear in, sorted alphabetically and deduplicated', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    // A powiat present under two voivodeships, a duplicate row, and a
    // voivodeship with no powiat set — the grouping must not crash on the
    // null and must not offer a "powiat" option that doesn't actually exist
    // for that voivodeship.
    prisma.gmina.findMany.mockResolvedValue([
      { voivodeship: 'mazowieckie', powiat: 'zamojski' },
      { voivodeship: 'mazowieckie', powiat: 'warszawski' },
      { voivodeship: 'lubelskie', powiat: 'zamojski' },
      { voivodeship: 'lubelskie', powiat: 'zamojski' },
      { voivodeship: 'podlaskie', powiat: null },
    ] as any);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.locations).toEqual([
      { voivodeship: 'lubelskie', powiats: ['zamojski'] },
      { voivodeship: 'mazowieckie', powiats: ['warszawski', 'zamojski'] },
      { voivodeship: 'podlaskie', powiats: [] },
    ]);
  });
});
