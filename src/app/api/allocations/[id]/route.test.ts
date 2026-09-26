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
import { PATCH } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const baseAllocation = {
  id: 'alloc1',
  needId: 'need1',
  alertId: 'a1',
  resourceId: 'r1',
  categoryId: 'cat1',
  itemName: 'Koce',
  quantity: 5,
  quantityReturned: 0,
  quantityNotReturnable: 0,
  unit: 'szt',
  donorOrgId: 'donor-org',
  recipientOrgId: 'owner-org',
  status: 'DELIVERY_AGREED',
  deliveredAt: null,
  returnAgreedAt: null,
  alert: { id: 'a1', gminaId: 'g1', organizationId: 'owner-org' },
};

function makeRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/allocations/alloc1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'alloc1' } };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
  prisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])) as any);
});

describe('PATCH /api/allocations/[id]', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ status: 'DELIVERED' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the allocation does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resourceAllocation.findUnique.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ status: 'DELIVERED' }), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects an invalid target status', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await PATCH(makeRequest({ status: 'RETURNED' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.resourceAllocation.update).not.toHaveBeenCalled();
  });

  it('rejects skipping a state (DELIVERY_AGREED -> RETURN_AGREED) with 400, for anyone', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await PATCH(makeRequest({ status: 'RETURN_AGREED' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.resourceAllocation.update).not.toHaveBeenCalled();
  });

  it('rejects a caller who is neither the donor nor the recipient organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'unrelated-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await PATCH(makeRequest({ status: 'DELIVERED' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.update).not.toHaveBeenCalled();
  });

  it('allows the DONOR to confirm DELIVERED', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'DELIVERED' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.allocation.status).toBe('DELIVERED');
    expect(prisma.resourceAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc1' },
      data: expect.objectContaining({ status: 'DELIVERED', deliveredAt: expect.any(Date) }),
    });
  });

  it('allows the RECIPIENT to confirm DELIVERED', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'DELIVERED' }), ctx);

    expect(res.status).toBe(200);
  });

  it('rejects the DONOR trying to move DELIVERED -> RETURN_AGREED (recipient-only)', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);

    const res = await PATCH(makeRequest({ status: 'RETURN_AGREED' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.update).not.toHaveBeenCalled();
  });

  it('allows the RECIPIENT to move DELIVERED -> RETURN_AGREED', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'RETURN_AGREED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'RETURN_AGREED' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.allocation.status).toBe('RETURN_AGREED');
    expect(prisma.resourceAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc1' },
      data: expect.objectContaining({ status: 'RETURN_AGREED', returnAgreedAt: expect.any(Date) }),
    });
  });

  it('allows ADMIN to force DELIVERED -> RETURN_AGREED even though ADMIN is neither donor nor recipient', async () => {
    const user = { id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'RETURN_AGREED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'RETURN_AGREED' }), ctx);

    expect(res.status).toBe(200);
  });

  it('records an audit entry with before/after status', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    await PATCH(makeRequest({ status: 'DELIVERED' }), ctx);

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESOURCE_ALLOCATION_STATUS_CHANGE', entityId: 'alloc1', gminaId: 'g1' }),
      })
    );
  });

  it('rejects the RECIPIENT trying to cancel a DELIVERY_AGREED allocation (donor-only)', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await PATCH(makeRequest({ status: 'CANCELLED' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.update).not.toHaveBeenCalled();
  });

  it('rejects cancelling an allocation that has already been delivered', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);

    const res = await PATCH(makeRequest({ status: 'CANCELLED' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.resourceAllocation.update).not.toHaveBeenCalled();
  });

  it('lets the DONOR cancel their own still-unconfirmed allocation, releasing the resource and need', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resource.findUnique.mockResolvedValue({ id: 'r1', quantity: 10, reservedQuantity: 5, organizationId: 'donor-org' } as any);
    prisma.alertNeed.findUnique.mockResolvedValue({ id: 'need1', alertId: 'a1', quantityNeeded: 10, quantityFulfilled: 5, status: 'PARTIALLY_FULFILLED' } as any);
    prisma.resource.update.mockResolvedValue({} as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'CANCELLED' } as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([] as any);
    prisma.alertNeed.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'CANCELLED' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.allocation.status).toBe('CANCELLED');
    expect(prisma.resource.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { reservedQuantity: { decrement: 5 } },
    });
    expect(prisma.resourceAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc1' },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.alertNeed.update).toHaveBeenCalledWith({
      where: { id: 'need1' },
      data: { quantityFulfilled: 0, status: 'OPEN' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESOURCE_ALLOCATION_STATUS_CHANGE', entityId: 'alloc1' }),
      })
    );
  });

  it('allows a gmina-scoped ADMIN to cancel even though they are not the donor', async () => {
    const user = { id: 'admin-1', role: 'ADMIN', gminaId: 'g1', organizationId: null };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resource.findUnique.mockResolvedValue({ id: 'r1', quantity: 10, reservedQuantity: 5, organizationId: 'donor-org' } as any);
    prisma.alertNeed.findUnique.mockResolvedValue({ id: 'need1', alertId: 'a1', quantityNeeded: 10, quantityFulfilled: 5, status: 'PARTIALLY_FULFILLED' } as any);
    prisma.resource.update.mockResolvedValue({} as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'CANCELLED' } as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([] as any);
    prisma.alertNeed.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'CANCELLED' }), ctx);

    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/allocations/[id] — quantity edit (DELIVERY_AGREED only)', () => {
  const baseResource = { id: 'r1', quantity: 10, reservedQuantity: 5, organizationId: 'donor-org' };
  const baseNeed = { id: 'need1', alertId: 'a1', quantityNeeded: 10, quantityFulfilled: 5, status: 'PARTIALLY_FULFILLED' };

  it('rejects a caller who is not the donor organization', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await PATCH(makeRequest({ quantity: 8 }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects editing once the allocation has moved past DELIVERY_AGREED', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);

    const res = await PATCH(makeRequest({ quantity: 8 }), ctx);

    expect(res.status).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-positive quantity', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await PATCH(makeRequest({ quantity: 0 }), ctx);

    expect(res.status).toBe(400);
  });

  it('is a no-op (200, no writes) when the new quantity equals the current one', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await PATCH(makeRequest({ quantity: baseAllocation.quantity }), ctx);

    expect(res.status).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets the DONOR lower the quantity, releasing the difference back to the resource and need', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.alertNeed.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, quantity: 3 } as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([{ status: 'DELIVERY_AGREED', quantity: 3 }] as any);
    prisma.alertNeed.update.mockResolvedValue(baseNeed as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ quantity: 3 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.allocation.quantity).toBe(3);
    // delta = 3 - 5 = -2
    expect(prisma.resource.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', reservedQuantity: { lte: 10 - -2 } },
      data: { reservedQuantity: { increment: -2 } },
    });
    expect(prisma.alertNeed.updateMany).toHaveBeenCalledWith({
      where: { id: 'need1', status: { notIn: ['CLOSED', 'CANCELLED'] }, quantityFulfilled: { lte: 10 - -2 } },
      data: { quantityFulfilled: { increment: -2 } },
    });
    expect(prisma.resourceAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc1' },
      data: { quantity: 3 },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESOURCE_ALLOCATION_UPDATE', entityId: 'alloc1' }),
      })
    );
  });

  it('allows a gmina-scoped ADMIN to edit even though they are not the donor', async () => {
    const user = { id: 'admin-1', role: 'ADMIN', gminaId: 'g1', organizationId: null };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.alertNeed.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, quantity: 7 } as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([{ status: 'DELIVERY_AGREED', quantity: 7 }] as any);
    prisma.alertNeed.update.mockResolvedValue(baseNeed as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ quantity: 7 }), ctx);

    expect(res.status).toBe(200);
  });

  it('returns 409 when the new quantity no longer fits the resource (atomic guard)', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.updateMany.mockResolvedValue({ count: 0 } as any);

    const res = await PATCH(makeRequest({ quantity: 9 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/dostępną ilość/);
    expect(prisma.resourceAllocation.update).not.toHaveBeenCalled();
  });

  it('returns 409 when the new quantity no longer fits the need (atomic guard)', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.alertNeed.updateMany.mockResolvedValue({ count: 0 } as any);

    const res = await PATCH(makeRequest({ quantity: 9 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/brakującą ilość/);
    expect(prisma.resourceAllocation.update).not.toHaveBeenCalled();
  });
});
