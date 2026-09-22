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
import { fakeCheckViolation } from '@/lib/__mocks__/prismaErrors';
import { POST } from './route';

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
  status: 'RETURN_AGREED',
  alert: { id: 'a1', gminaId: 'g1', organizationId: 'owner-org' },
};

function makeRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/allocations/alloc1/return-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'alloc1' } };
const validBody = { quantityReturned: 3, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
  prisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])) as any);
});

describe('POST /api/allocations/[id]/return-events', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await POST(makeRequest(validBody), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the allocation does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resourceAllocation.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a caller who is not the recipient organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await POST(makeRequest(validBody), ctx);

    expect(res.status).toBe(403);
    expect(prisma.allocationReturnEvent.create).not.toHaveBeenCalled();
  });

  it('rejects recording a return before RETURN_AGREED', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, status: 'DELIVERED' } as any);

    const res = await POST(makeRequest(validBody), ctx);

    expect(res.status).toBe(409);
    expect(prisma.allocationReturnEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a return on an already-terminal allocation', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, status: 'RETURNED' } as any);

    const res = await POST(makeRequest(validBody), ctx);

    expect(res.status).toBe(409);
  });

  it('rejects a body where both quantities are zero', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await POST(makeRequest({ quantityReturned: 0, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.allocationReturnEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a missing returnedAt', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await POST(makeRequest({ quantityReturned: 3 }), ctx);

    expect(res.status).toBe(400);
  });

  it('rejects when the projected total exceeds the allocation quantity (accounting for prior events)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, quantity: 5 } as any);
    prisma.allocationReturnEvent.findMany.mockResolvedValue([{ quantityReturned: 4, quantityNotReturnable: 0 }] as any);

    const res = await POST(makeRequest({ quantityReturned: 2, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' }), ctx);

    expect(res.status).toBe(409);
    expect(prisma.allocationReturnEvent.create).not.toHaveBeenCalled();
  });

  it('records a full return, sets status RETURNED, and releases the full reservation', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    // First call is the pre-check (no prior events); second is the
    // post-create recompute inside the transaction (includes the new event).
    prisma.allocationReturnEvent.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ quantityReturned: 5, quantityNotReturnable: 0 }] as any);
    const createdEvent = {
      id: 'evt1',
      allocationId: 'alloc1',
      quantityReturned: 5,
      quantityNotReturnable: 0,
      notReturnableReason: null,
      message: null,
      returnedAt: new Date('2026-09-17T10:00:00.000Z'),
      recordedById: 'c1',
    };
    prisma.allocationReturnEvent.create.mockResolvedValue(createdEvent as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'RETURNED', quantityReturned: 5 } as any);
    prisma.resource.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest({ quantityReturned: 5, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.allocation.status).toBe('RETURNED');
    expect(prisma.resourceAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc1' },
      data: { quantityReturned: 5, quantityNotReturnable: 0, status: 'RETURNED' },
    });
    expect(prisma.resource.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { reservedQuantity: { increment: -5 }, quantity: { increment: 0 } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'RESOURCE_ALLOCATION_RETURN', entityId: 'alloc1' }) })
    );
  });

  it('records a partial return with a not-returnable portion, permanently deducting resource.quantity', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.allocationReturnEvent.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ quantityReturned: 3, quantityNotReturnable: 2 }] as any);
    const createdEvent = {
      id: 'evt1',
      allocationId: 'alloc1',
      quantityReturned: 3,
      quantityNotReturnable: 2,
      notReturnableReason: 'Uszkodzone',
      message: 'Zwrócono częściowo',
      returnedAt: new Date('2026-09-17T10:00:00.000Z'),
      recordedById: 'c1',
    };
    prisma.allocationReturnEvent.create.mockResolvedValue(createdEvent as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'RETURNED', quantityReturned: 3, quantityNotReturnable: 2 } as any);
    prisma.resource.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(
      makeRequest({
        quantityReturned: 3,
        quantityNotReturnable: 2,
        notReturnableReason: 'Uszkodzone',
        message: 'Zwrócono częściowo',
        returnedAt: '2026-09-17T10:00:00.000Z',
      }),
      ctx
    );

    expect(res.status).toBe(201);
    expect(prisma.resource.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { reservedQuantity: { increment: -5 }, quantity: { increment: -2 } },
    });
  });

  it('allows ADMIN to record a return even though ADMIN is not the recipient organization', async () => {
    const user = { id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.allocationReturnEvent.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ quantityReturned: 5, quantityNotReturnable: 0 }] as any);
    prisma.allocationReturnEvent.create.mockResolvedValue({
      id: 'evt1',
      quantityReturned: 5,
      quantityNotReturnable: 0,
    } as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'RETURNED' } as any);
    prisma.resource.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest({ quantityReturned: 5, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' }), ctx);

    expect(res.status).toBe(201);
  });

  it('skips the resource counter update when the source resource was deleted (resourceId null)', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue({ ...baseAllocation, resourceId: null } as any);
    prisma.allocationReturnEvent.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ quantityReturned: 5, quantityNotReturnable: 0 }] as any);
    prisma.allocationReturnEvent.create.mockResolvedValue({ id: 'evt1', quantityReturned: 5, quantityNotReturnable: 0 } as any);
    prisma.resourceAllocation.update.mockResolvedValue({ ...baseAllocation, status: 'RETURNED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest({ quantityReturned: 5, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' }), ctx);

    expect(res.status).toBe(201);
    expect(prisma.resource.update).not.toHaveBeenCalled();
  });

  // Two returns for the same allocation recorded at once: both pass the
  // snapshot projectedTotal check, the loser hits the DB CHECK constraint
  // allocation_returns_within_quantity when its update lands.
  it('maps a DB CHECK constraint violation inside the transaction to 409, not 500', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.allocationReturnEvent.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ quantityReturned: 5, quantityNotReturnable: 0 }, { quantityReturned: 3, quantityNotReturnable: 0 }] as any);
    prisma.allocationReturnEvent.create.mockResolvedValue({ id: 'evt2', quantityReturned: 3, quantityNotReturnable: 0 } as any);
    prisma.resourceAllocation.update.mockRejectedValue(
      fakeCheckViolation('allocation_returns_within_quantity', 'ResourceAllocation')
    );

    const res = await POST(makeRequest({ quantityReturned: 3, quantityNotReturnable: 0, returnedAt: '2026-09-17T10:00:00.000Z' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('przekroczyłaby ilość tego przydziału');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
