import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function makeGetRequest(query = '') {
  return new NextRequest(`http://localhost/api/resources${query}`);
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('GET /api/resources', () => {
  it('returns 403 with no DB call when the caller is not ADMIN/COORDINATOR', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(403);
    expect(prisma.resource.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty list (fail closed) for a gmina-scoped role with no gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: null });

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.resources).toEqual([]);
    expect(prisma.resource.findMany).not.toHaveBeenCalled();
  });

  it('scopes an ADMIN to no gmina filter and applies query filters', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resource.findMany.mockResolvedValue([]);

    await GET(makeGetRequest('?organizationId=o1&categoryId=c1&horizon=H48'));

    expect(prisma.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'o1', categoryId: 'c1', horizon: 'H48' }),
      })
    );
  });

  it('scopes a COORDINATOR to their own gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1' });
    prisma.resource.findMany.mockResolvedValue([]);

    await GET(makeGetRequest());

    expect(prisma.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ gminaId: 'g1' }) })
    );
  });
});

describe('POST /api/resources', () => {
  it('rejects with 403 and no DB write when the caller is not ADMIN/COORDINATOR', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await POST(makePostRequest({ name: 'Koce', categoryId: 'c1', quantity: 5 }));

    expect(res.status).toBe(403);
    expect(prisma.resource.create).not.toHaveBeenCalled();
  });

  it('rejects a caller with no organization before touching the database', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });

    const res = await POST(makePostRequest({ name: 'Koce', categoryId: 'c1', quantity: 5 }));

    expect(res.status).toBe(400);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a missing name before touching the database', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });

    const res = await POST(makePostRequest({ categoryId: 'c1', quantity: 5 }));

    expect(res.status).toBe(400);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a negative quantity', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });

    const res = await POST(makePostRequest({ name: 'Koce', categoryId: 'c1', quantity: -1 }));

    expect(res.status).toBe(400);
  });

  it("rejects when the caller's organization no longer exists", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });
    prisma.organization.findUnique.mockResolvedValue(null);

    const res = await POST(makePostRequest({ name: 'Koce', categoryId: 'c1', quantity: 5 }));

    expect(res.status).toBe(400);
    expect(prisma.resourceCategory.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown category', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });
    prisma.organization.findUnique.mockResolvedValue({ id: 'o1', gminaId: 'g1' } as any);
    prisma.resourceCategory.findUnique.mockResolvedValue(null);

    const res = await POST(makePostRequest({ name: 'Koce', categoryId: 'bad', quantity: 5 }));

    expect(res.status).toBe(400);
    expect(prisma.resource.create).not.toHaveBeenCalled();
  });

  it("creates a resource for the caller's own organization and gmina, and records an audit entry", async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.organization.findUnique.mockResolvedValue({ id: 'o1', gminaId: 'g1' } as any);
    prisma.resourceCategory.findUnique.mockResolvedValue({ id: 'cat1' } as any);
    prisma.resource.create.mockResolvedValue({
      id: 'r1',
      name: 'Koce',
      description: null,
      quantity: 5,
      unit: 'szt',
      status: 'AVAILABLE',
      categoryId: 'cat1',
      gminaId: 'g1',
      organizationId: 'o1',
      horizon: 'H24',
      location: null,
    } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makePostRequest({ name: 'Koce', categoryId: 'cat1', quantity: 5 }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.resource.id).toBe('r1');
    expect(prisma.resource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Koce',
        categoryId: 'cat1',
        quantity: 5,
        gminaId: 'g1',
        organizationId: 'o1',
        horizon: 'H24',
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESOURCE_CREATE', entityType: 'RESOURCE', entityId: 'r1' }),
      })
    );
  });
});
