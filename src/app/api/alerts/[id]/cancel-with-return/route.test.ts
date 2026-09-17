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
import { POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const baseAlert = { id: 'a1', gminaId: 'g1', organizationId: 'owner-org', status: 'ACTIVE' };

const deliveredAllocation = {
  id: 'alloc-delivered',
  alertId: 'a1',
  resourceId: 'r1',
  needId: 'need1',
  itemName: 'Koce',
  quantity: 5,
  quantityReturned: 0,
  quantityNotReturnable: 0,
  status: 'DELIVERED',
};
const undeliveredAllocation = {
  id: 'alloc-undelivered',
  alertId: 'a1',
  resourceId: 'r2',
  needId: 'need1',
  itemName: 'Woda',
  quantity: 3,
  quantityReturned: 0,
  quantityNotReturnable: 0,
  status: 'DELIVERY_AGREED',
};

function makeRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/alerts/a1/cancel-with-return', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'a1' } };
const validEntry = { allocationId: 'alloc-delivered', quantityReturned: 5, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
  prisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])) as any);
});

describe('POST /api/alerts/[id]/cancel-with-return', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await POST(makeRequest({ returns: [] }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the alert does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest({ returns: [] }), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a COORDINATOR whose organization does NOT own the alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest({ returns: [] }), ctx);

    expect(res.status).toBe(403);
  });

  it("rejects ADMIN too, since cancel-with-return is the OWNER org's own flow (нюанс #5)", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest({ returns: [] }), ctx);

    expect(res.status).toBe(403);
  });

  it('rejects an already-cancelled alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue({ ...baseAlert, status: 'CANCELLED' } as any);

    const res = await POST(makeRequest({ returns: [] }), ctx);

    expect(res.status).toBe(409);
  });

  it('rejects duplicate allocationId entries', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest({ returns: [validEntry, validEntry] }), ctx);

    expect(res.status).toBe(400);
  });

  it('returns 409 MISSING_RETURN_DECISIONS when a delivered allocation has no matching entry', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([deliveredAllocation] as any);

    const res = await POST(makeRequest({ returns: [] }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('MISSING_RETURN_DECISIONS');
    expect(body.missingAllocationIds).toEqual(['alloc-delivered']);
    expect(prisma.allocationReturnEvent.create).not.toHaveBeenCalled();
  });

  it('does NOT require a decision for an undelivered (DELIVERY_AGREED) allocation', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceAllocation.findMany
      .mockResolvedValueOnce([undeliveredAllocation] as any) // top-level non-terminal fetch
      .mockResolvedValueOnce([] as any); // needs recompute pass inside tx
    prisma.allocationReturnEvent.findMany.mockResolvedValue([]);
    prisma.resourceAllocation.update.mockResolvedValue({ ...undeliveredAllocation, status: 'CANCELLED' } as any);
    prisma.resource.update.mockResolvedValue({} as any);
    prisma.alertNeed.findMany.mockResolvedValue([]);
    prisma.alert.update.mockResolvedValue({ ...baseAlert, status: 'CANCELLED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest({ returns: [] }), ctx);

    expect(res.status).toBe(200);
    expect(prisma.resourceAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-undelivered' },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.resource.update).toHaveBeenCalledWith({
      where: { id: 'r2' },
      data: { reservedQuantity: { decrement: 3 } },
    });
  });

  it('rejects a decision entry targeting an undelivered allocation', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([undeliveredAllocation] as any);

    const res = await POST(
      makeRequest({ returns: [{ allocationId: 'alloc-undelivered', quantityReturned: 3, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' }] }),
      ctx
    );

    expect(res.status).toBe(400);
  });

  it('rejects when the projected return total exceeds the allocation quantity', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceAllocation.findMany.mockResolvedValue([deliveredAllocation] as any);
    prisma.allocationReturnEvent.findMany.mockResolvedValue([{ quantityReturned: 4, quantityNotReturnable: 0 }] as any);

    const res = await POST(
      makeRequest({ returns: [{ allocationId: 'alloc-delivered', quantityReturned: 2, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' }] }),
      ctx
    );

    expect(res.status).toBe(409);
    expect(prisma.allocationReturnEvent.create).not.toHaveBeenCalled();
  });

  it('processes a delivered return, auto-cancels the undelivered one, closes needs, and cancels the alert', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceAllocation.findMany
      .mockResolvedValueOnce([deliveredAllocation, undeliveredAllocation] as any) // top-level non-terminal fetch
      .mockResolvedValueOnce([{ status: 'RETURNED', quantity: 5 }] as any); // needs recompute pass inside tx
    prisma.allocationReturnEvent.findMany
      .mockResolvedValueOnce([]) // pre-check for the one entry
      .mockResolvedValueOnce([{ quantityReturned: 5, quantityNotReturnable: 0 }] as any); // inside tx after create
    prisma.allocationReturnEvent.create.mockResolvedValue({
      id: 'evt1',
      allocationId: 'alloc-delivered',
      quantityReturned: 5,
      quantityNotReturnable: 0,
    } as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...deliveredAllocation, status: 'RETURNED', quantityReturned: 5 } as any);
    prisma.resource.update.mockResolvedValue({} as any);
    prisma.alertNeed.findMany.mockResolvedValue([{ id: 'need1', alertId: 'a1', quantityNeeded: 5, status: 'FULFILLED' }] as any);
    prisma.alertNeed.update.mockResolvedValue({} as any);
    prisma.alert.update.mockResolvedValue({ ...baseAlert, status: 'CANCELLED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest({ returns: [validEntry] }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alert.status).toBe('CANCELLED');
    expect(prisma.allocationReturnEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ allocationId: 'alloc-delivered', quantityReturned: 5, quantityNotReturnable: 0 }),
    });
    expect(prisma.resourceAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-undelivered' },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.resource.update).toHaveBeenCalledWith({
      where: { id: 'r2' },
      data: { reservedQuantity: { decrement: 3 } },
    });
    expect(prisma.alertNeed.update).toHaveBeenCalledWith({
      where: { id: 'need1' },
      data: { quantityFulfilled: expect.any(Number), status: 'CLOSED' },
    });
    expect(prisma.alert.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'CANCELLED' } });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
  });
});
