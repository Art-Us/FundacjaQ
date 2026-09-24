import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdminOrCoordinator: vi.fn() };
});
// Auto-mocked: every export becomes a vi.fn() returning undefined, i.e. an
// always-miss cache, so these tests exercise the same Postgres-fallback path
// as before this cache existed — without this, findAlertAccess() would hit
// the real Redis client and leak state across tests.
vi.mock('@/lib/alertAccessCache');

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { fakeCheckViolation } from '@/lib/__mocks__/prismaErrors';
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

  // Without this guard, a donor whose "Przydziel zasoby" form was already
  // open could still allocate against an alert someone just closed — the
  // reservation then has no path back (cancel-with-return only runs for the
  // owner's own CANCELLED flow, never for a plain PATCH to RESOLVED).
  it.each(['RESOLVED', 'CANCELLED'])('rejects allocating against a %s alert', async (status) => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue({ ...baseAlert, status } as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('zamknięty');
    expect(prisma.alertNeed.findUnique).not.toHaveBeenCalled();
  });

  it.each(['ACTIVE', 'IN_PROGRESS'])('still allows allocating against a %s alert', async (status) => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue({ ...baseAlert, status } as any);
    prisma.alertNeed.findUnique.mockResolvedValue({ ...baseNeed, status: 'CLOSED' } as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);

    // Falls through to the next guard (need CLOSED) rather than the alert-status one.
    expect(res.status).toBe(409);
    expect(prisma.alertNeed.findUnique).toHaveBeenCalled();
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
    prisma.resource.updateMany.mockResolvedValue({ count: 1 });
    prisma.alertNeed.updateMany.mockResolvedValue({ count: 1 });
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
    // The reservation is a single conditional statement — the "still has
    // room" check lives in `where`, so the increment can't land on a resource
    // that a concurrent allocation has meanwhile filled up (quantity 10 - 3).
    expect(prisma.resource.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', organizationId: 'donor-org', reservedQuantity: { lte: 7 } },
      data: { reservedQuantity: { increment: 3 } },
    });
    // Same for the need: quantityNeeded 5 - 3 = 2 still allowed to be already fulfilled.
    expect(prisma.alertNeed.updateMany).toHaveBeenCalledWith({
      where: { id: 'need1', status: { notIn: ['CLOSED', 'CANCELLED'] }, quantityFulfilled: { lte: 2 } },
      data: { quantityFulfilled: { increment: 3 } },
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

  it('reserves before creating and only after the need guard passed (lock order resource → need → allocation)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    const order: string[] = [];
    prisma.resource.updateMany.mockImplementation((async () => {
      order.push('resource.updateMany');
      return { count: 1 };
    }) as any);
    prisma.alertNeed.updateMany.mockImplementation((async () => {
      order.push('alertNeed.updateMany');
      return { count: 1 };
    }) as any);
    prisma.resourceAllocation.create.mockImplementation((async () => {
      order.push('resourceAllocation.create');
      return { id: 'alloc1', status: 'DELIVERY_AGREED' };
    }) as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([{ status: 'DELIVERY_AGREED', quantity: 3 }] as any);
    prisma.alertNeed.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 3 }), ctx);

    expect(res.status).toBe(201);
    expect(order).toEqual(['resource.updateMany', 'alertNeed.updateMany', 'resourceAllocation.create']);
  });

  // The pre-transaction `available` check passes (snapshot says 10 free), but
  // by the time the conditional UPDATE runs another donor has reserved the
  // stock — Postgres returns 0 affected rows. Must be a 409, and nothing
  // else in the transaction may run.
  it('returns 409 and creates nothing when a concurrent allocation exhausted the resource first', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.resource.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 5 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('Zbyt mała dostępna ilość');
    expect(prisma.alertNeed.updateMany).not.toHaveBeenCalled();
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
    expect(prisma.alertNeed.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  // Mirror image: the resource still has room, but another donor (or the
  // owner org closing the need) beat us on the need row. The transaction
  // throws → Prisma rolls the resource increment back; the route must still
  // answer 409 and not create the allocation.
  it('returns 409 and creates nothing when a concurrent allocation filled the need first', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.resource.updateMany.mockResolvedValue({ count: 1 });
    prisma.alertNeed.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 5 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('Przekracza brakującą ilość');
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  // Resource.quantity shrank between our snapshot read and the conditional
  // update, so the `lte` guard (built from the stale quantity) let the
  // increment through — and the DB CHECK constraint rejected it instead.
  it('maps a DB CHECK constraint violation inside the transaction to 409', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.resource.updateMany.mockRejectedValue(fakeCheckViolation('resource_reserved_within_quantity'));

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('dostępnej ilości');
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
  });

  it('still answers 500 (not 409) for an unexpected database error inside the transaction', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.resource.updateMany.mockRejectedValue(new Error('connection lost'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest('POST', { needId: 'need1', resourceId: 'r1', quantity: 2 }), ctx);

    expect(res.status).toBe(500);
    expect(prisma.resourceAllocation.create).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
