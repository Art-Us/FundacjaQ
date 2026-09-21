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

const baseAlert = { id: 'a1', gminaId: 'g1', organizationId: 'owner-org' };
const baseNeed = {
  id: 'need1',
  alertId: 'a1',
  categoryId: 'cat1',
  quantityNeeded: 5,
  quantityFulfilled: 0,
  status: 'OPEN',
};
const baseResource = {
  id: 'r1',
  name: 'Koce',
  categoryId: 'cat1',
  unit: 'szt',
  quantity: 10,
  reservedQuantity: 0,
  organizationId: 'donor-org',
};

function makeRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/alerts/a1/allocations', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'a1' } };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
  prisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])) as any);
});

describe('GET /api/alerts/[id]/allocations', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the alert does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a COORDINATOR from a different gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'other-gmina' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.findMany).not.toHaveBeenCalled();
  });

  it('allows a COORDINATOR from the same gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/alerts/[id]/allocations', () => {
  it('rejects with 403 when the caller is not ADMIN/COORDINATOR', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
  });

  it('rejects a caller with no organization before touching the database', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the alert does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a missing resourceId before touching the database', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', quantity: 2 }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alertNeed.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the need does not belong to this alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue({ ...baseNeed, alertId: 'other-alert' } as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a CLOSED need', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue({ ...baseNeed, status: 'CLOSED' } as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);

    expect(res.status).toBe(409);
    expect(prisma.resource.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a resource that does NOT belong to the caller's organization", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'other-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
  });

  it('rejects allocating more than the available (unreserved) quantity', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.findUnique.mockResolvedValue({ ...baseResource, quantity: 10, reservedQuantity: 9 } as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 5 }), ctx);

    expect(res.status).toBe(409);
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
  });

  it('rejects allocating more than the need still lacks, even with plenty of resource stock', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    // quantityNeeded 5, quantityFulfilled 2 -> only 3 left to fill.
    prisma.alertNeed.findUnique.mockResolvedValue({ ...baseNeed, quantityFulfilled: 2, unit: 'szt' } as any);
    prisma.resource.findUnique.mockResolvedValue({ ...baseResource, quantity: 100, reservedQuantity: 0 } as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 4 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('brakuje 3 szt');
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
  });

  it('creates the allocation, reserves the resource, recalculates the need, and records an audit entry', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    const createdAllocation = {
      id: 'alloc1',
      needId: 'need1',
      alertId: 'a1',
      resourceId: 'r1',
      categoryId: 'cat1',
      itemName: 'Koce',
      quantity: 3,
      unit: 'szt',
      donorOrgId: 'donor-org',
      recipientOrgId: 'owner-org',
      status: 'DELIVERY_AGREED',
    };
    prisma.resourceAllocation.create.mockResolvedValue(createdAllocation as any);
    prisma.resource.update.mockResolvedValue({} as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([{ status: 'DELIVERY_AGREED', quantity: 3 }] as any);
    prisma.alertNeed.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 3 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.allocation.id).toBe('alloc1');
    expect(prisma.resourceAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        needId: 'need1',
        alertId: 'a1',
        resourceId: 'r1',
        categoryId: 'cat1',
        itemName: 'Koce',
        quantity: 3,
        unit: 'szt',
        donorOrgId: 'donor-org',
        recipientOrgId: 'owner-org',
        createdById: 'c1',
      }),
    });
    expect(prisma.resource.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { reservedQuantity: { increment: 3 } },
    });
    expect(prisma.alertNeed.update).toHaveBeenCalledWith({
      where: { id: 'need1' },
      data: { quantityFulfilled: 3, status: 'PARTIALLY_FULFILLED' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESOURCE_ALLOCATION_CREATE', entityType: 'RESOURCE_ALLOCATION', entityId: 'alloc1' }),
      })
    );
  });
});
