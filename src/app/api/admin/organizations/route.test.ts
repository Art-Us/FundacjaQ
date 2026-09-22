import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock('@/lib/adminEvents', () => ({
  publishAdminEvent: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/organizations${query}`);
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/organizations', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(403);
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
    expect(prisma.organization.count).not.toHaveBeenCalled();
  });

  it('returns the organization list, total and pagination for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(1);
    prisma.organization.findMany.mockResolvedValue([{ id: 'o1', name: 'Caritas' }] as any);

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.organizations).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.totalPages).toBe(1);
  });

  it('applies page=1/pageSize=30 and name:asc ordering when no query params are given', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);

    await GET(makeGetRequest());

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        skip: 0,
        take: 30,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      })
    );
  });

  it('searches name/city/contact names/gmina name and orders by the requested field', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?q=caritas&sortBy=city&sortDir=desc'));

    const call = prisma.organization.findMany.mock.calls[0][0] as any;
    expect(call.orderBy).toEqual([{ city: 'desc' }, { id: 'asc' }]);
    expect(call.where).toEqual({
      OR: [
        { name: { contains: 'caritas', mode: 'insensitive' } },
        { city: { contains: 'caritas', mode: 'insensitive' } },
        { contactFirstName: { contains: 'caritas', mode: 'insensitive' } },
        { contactLastName: { contains: 'caritas', mode: 'insensitive' } },
        { gmina: { name: { contains: 'caritas', mode: 'insensitive' } } },
      ],
    });
  });

  it('sorts by gmina name via the relation', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?sortBy=gmina&sortDir=asc'));

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ gmina: { name: 'asc' } }, { id: 'asc' }] })
    );
  });

  it('sorts by powiat/voivodeship via the relation', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?sortBy=powiat&sortDir=desc'));
    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ gmina: { powiat: 'desc' } }, { id: 'asc' }] })
    );

    await GET(makeGetRequest('?sortBy=voivodeship&sortDir=asc'));
    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ gmina: { voivodeship: 'asc' } }, { id: 'asc' }] })
    );
  });

  it('filters by gminaId alone', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?gminaId=g1'));

    expect(prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { gminaId: 'g1' } }));
  });

  it('filters by voivodeship/powiat through the gmina relation', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?voivodeship=mazowieckie&powiat=warszawski'));

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gmina: { voivodeship: 'mazowieckie', powiat: 'warszawski' } },
      })
    );
  });

  it('paginates using page/pageSize', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?page=3&pageSize=10'));

    expect(prisma.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });

  it('rejects invalid query params with 400', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await GET(makeGetRequest('?pageSize=9999'));

    expect(res.status).toBe(400);
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
  });

  it('returns 500 when the database read fails', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockRejectedValue(new Error('connection lost'));

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(500);
  });

  it('scopes a gmina-scoped admin to only their own gmina, ignoring a different gminaId query param', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
    prisma.organization.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?gminaId=gmina-2'));

    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gminaId: 'gmina-1' } })
    );
  });
});

describe('POST /api/admin/organizations', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'g1' }));

    expect(res.status).toBe(403);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('creates an organization with the given fields', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({ id: 'o1', name: 'Caritas', gminaId: 'g1' } as any);

    const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'g1', city: 'Kraków' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.organization).toEqual({ id: 'o1', name: 'Caritas', gminaId: 'g1' });
    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: { name: 'Caritas', gmina: { connect: { id: 'g1' } }, city: 'Kraków', contactEmail: null },
    });
  });

  it('rejects a name that already exists in the SAME gmina, ignoring case, with 409 and no write', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockResolvedValue({ id: 'existing-1', name: 'Caritas', gminaId: 'g1' } as any);

    const res = await POST(makeRequest({ name: '  caritas  ', gminaId: 'g1' }));

    expect(res.status).toBe(409);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('rejects a missing name before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ gminaId: 'g1' }));

    expect(res.status).toBe(400);
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a missing gminaId before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ name: 'Caritas' }));

    expect(res.status).toBe(400);
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an invalid contact email', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'g1', contactEmail: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400 before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    const req = new NextRequest('http://localhost/api/admin/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  it('passes through a createOrganization() error (e.g. gmina does not exist) as 400', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'missing' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Wybrana gmina nie istnieje.');
  });

  describe('gmina-scoped admin actor', () => {
    it('can create an organization in their own gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.gmina.findUnique.mockResolvedValue({ id: 'gmina-1' } as any);
      prisma.organization.findFirst.mockResolvedValue(null);
      prisma.organization.create.mockResolvedValue({ id: 'o1', name: 'Caritas', gminaId: 'gmina-1' } as any);

      const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'gmina-1' }));

      expect(res.status).toBe(201);
    });

    it('rejects (403) creating an organization in a DIFFERENT gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });

      const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'gmina-2' }));

      expect(res.status).toBe(403);
      expect(prisma.organization.create).not.toHaveBeenCalled();
    });
  });
});
