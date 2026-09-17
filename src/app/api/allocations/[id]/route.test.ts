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
});
