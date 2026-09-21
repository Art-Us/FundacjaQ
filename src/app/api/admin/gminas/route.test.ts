import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return {
    ...actual,
    requireAdmin: vi.fn(),
  };
});
vi.mock('@/lib/adminEvents', () => ({
  publishAdminEvent: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/gminas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/gminas${query}`);
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/gminas', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(403);
    expect(prisma.gmina.findMany).not.toHaveBeenCalled();
    expect(prisma.gmina.count).not.toHaveBeenCalled();
  });

  it('returns the gmina list, total and pagination for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.count.mockResolvedValue(1);
    prisma.gmina.findMany.mockResolvedValue([{ id: 'g1', name: 'Warszawa' }] as any);

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.gminas).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.totalPages).toBe(1);
    expect(body.locations).toBeUndefined();
  });

  it('applies page=1/pageSize=30 and name:asc ordering when no query params are given', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.count.mockResolvedValue(0);
    prisma.gmina.findMany.mockResolvedValue([]);

    await GET(makeGetRequest());

    expect(prisma.gmina.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        skip: 0,
        take: 30,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      })
    );
  });

  it('filters by voivodeship alone', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.count.mockResolvedValue(0);
    prisma.gmina.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?voivodeship=mazowieckie'));

    expect(prisma.gmina.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { voivodeship: 'mazowieckie' } }));
  });

  it('filters by voivodeship/powiat and searches name/powiat/voivodeship', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.count.mockResolvedValue(0);
    prisma.gmina.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?voivodeship=mazowieckie&powiat=warszawski&q=warsz'));

    const call = prisma.gmina.findMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({
      voivodeship: 'mazowieckie',
      powiat: 'warszawski',
      OR: [
        { name: { contains: 'warsz', mode: 'insensitive' } },
        { powiat: { contains: 'warsz', mode: 'insensitive' } },
        { voivodeship: { contains: 'warsz', mode: 'insensitive' } },
      ],
    });
  });

  it('paginates using page/pageSize', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.count.mockResolvedValue(100);
    prisma.gmina.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?page=3&pageSize=10'));

    expect(prisma.gmina.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });

  it.each([
    ['voivodeship', 'desc', [{ voivodeship: 'desc' }, { id: 'asc' }]],
    ['powiat', 'asc', [{ powiat: 'asc' }, { id: 'asc' }]],
    ['createdAt', 'desc', [{ createdAt: 'desc' }, { id: 'asc' }]],
    ['name', 'desc', [{ name: 'desc' }, { id: 'asc' }]],
  ] as const)('sorts by %s:%s, with id as a stable tiebreaker', async (sortBy, sortDir, expectedOrderBy) => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.count.mockResolvedValue(0);
    prisma.gmina.findMany.mockResolvedValue([]);

    await GET(makeGetRequest(`?sortBy=${sortBy}&sortDir=${sortDir}`));

    expect(prisma.gmina.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: expectedOrderBy }));
  });

  it('rejects an unknown sortBy with 400 and no DB call', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await GET(makeGetRequest('?sortBy=notarealfield'));

    expect(res.status).toBe(400);
    expect(prisma.gmina.findMany).not.toHaveBeenCalled();
  });

  it.each(['?page=0', '?page=-1', '?page=1.5', '?pageSize=0', '?pageSize=101'])(
    'rejects an invalid pagination param (%s) with 400 and no DB call',
    async (query) => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

      const res = await GET(makeGetRequest(query));

      expect(res.status).toBe(400);
      expect(prisma.gmina.findMany).not.toHaveBeenCalled();
    }
  );

  it('returns 500 when the database call fails', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.count.mockRejectedValue(new Error('connection lost'));

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/gminas', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await POST(makeRequest({ name: 'Warszawa' }));

    expect(res.status).toBe(403);
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('creates a gmina with the given fields', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({ id: 'g1', name: 'Warszawa' } as any);

    const res = await POST(makeRequest({ name: 'Warszawa', powiat: 'warszawski' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.gmina).toEqual({ id: 'g1', name: 'Warszawa' });
    expect(prisma.gmina.create).toHaveBeenCalledWith({ data: { name: 'Warszawa', powiat: 'warszawski' } });
  });

  it('rejects a name that already exists, ignoring case and whitespace, with 409 and no write', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findFirst.mockResolvedValue({ id: 'existing-1', name: 'Warszawa' } as any);

    const res = await POST(makeRequest({ name: '  warszawa  ' }));

    expect(res.status).toBe(409);
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('rejects a missing name before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(prisma.gmina.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['latitude', 91],
    ['latitude', -91],
    ['longitude', 181],
    ['longitude', -181],
  ])('rejects an out-of-range %s (%d) with 400 and no DB write', async (field, value) => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ name: 'Warszawa', [field]: value }));

    expect(res.status).toBe(400);
    expect(prisma.gmina.findFirst).not.toHaveBeenCalled();
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });
});
