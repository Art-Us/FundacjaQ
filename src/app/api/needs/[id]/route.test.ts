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
import { PATCH, DELETE } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const baseNeed = {
  id: 'need1',
  alertId: 'a1',
  categoryId: 'cat1',
  title: 'Koce',
  description: null,
  quantityNeeded: 5,
  quantityFulfilled: 0,
  unit: 'szt',
  urgency: 'NORMAL',
  status: 'OPEN',
  alert: { id: 'a1', gminaId: 'g1', organizationId: 'owner-org' },
};

function makeRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/needs/need1', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'need1' } };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('PATCH /api/needs/[id]', () => {
  // Snapshot said quantityFulfilled 0; a donor allocated 4 in the meantime;
  // the owner shrinks quantityNeeded to 2 — the DB CHECK constraint
  // need_fulfilled_within_needed has the final say, surfaced as the same 409
  // the in-route guard gives.
  it('maps a DB CHECK constraint violation on the shrink to 409', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.alertNeed.update.mockRejectedValue(fakeCheckViolation('need_fulfilled_within_needed', 'AlertNeed'));

    const res = await PATCH(makeRequest('PATCH', { quantityNeeded: 2 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('poniżej już przydzielonej');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await PATCH(makeRequest('PATCH', { title: 'Nowy tytuł' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertNeed.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the need does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alertNeed.findUnique.mockResolvedValue(null);

    const res = await PATCH(makeRequest('PATCH', { title: 'Nowy tytuł' }), ctx);

    expect(res.status).toBe(404);
  });

  it("rejects a COORDINATOR whose organization does NOT own the alert", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);

    const res = await PATCH(makeRequest('PATCH', { title: 'Nowy tytuł' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertNeed.update).not.toHaveBeenCalled();
  });

  it('rejects an empty body', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);

    const res = await PATCH(makeRequest('PATCH', {}), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alertNeed.update).not.toHaveBeenCalled();
  });

  it('rejects a manual status outside CLOSED/CANCELLED', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);

    const res = await PATCH(makeRequest('PATCH', { status: 'FULFILLED' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alertNeed.update).not.toHaveBeenCalled();
  });

  it('rejects shrinking quantityNeeded below quantityFulfilled', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alertNeed.findUnique.mockResolvedValue({ ...baseNeed, quantityFulfilled: 3 } as any);

    const res = await PATCH(makeRequest('PATCH', { quantityNeeded: 2 }), ctx);

    expect(res.status).toBe(409);
    expect(prisma.alertNeed.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown category', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resourceCategory.findUnique.mockResolvedValue(null);

    const res = await PATCH(makeRequest('PATCH', { categoryId: 'bad' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alertNeed.update).not.toHaveBeenCalled();
  });

  it('allows the owner org to manually close a need and records an audit entry', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.alertNeed.update.mockResolvedValue({ ...baseNeed, status: 'CLOSED' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest('PATCH', { status: 'CLOSED' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.need.status).toBe('CLOSED');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ALERT_NEED_UPDATE', entityId: 'need1' }) })
    );
  });

  it('allows ADMIN to edit a need owned by another organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.alertNeed.update.mockResolvedValue({ ...baseNeed, title: 'Zaktualizowane' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest('PATCH', { title: 'Zaktualizowane' }), ctx);

    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/needs/[id]', () => {
  it('rejects a COORDINATOR whose organization does NOT own the alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);

    const res = await DELETE(makeRequest('DELETE'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertNeed.delete).not.toHaveBeenCalled();
  });

  it('rejects deletion with 409 when active allocations exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resourceAllocation.count.mockResolvedValue(1);

    const res = await DELETE(makeRequest('DELETE'), ctx);

    expect(res.status).toBe(409);
    expect(prisma.alertNeed.delete).not.toHaveBeenCalled();
  });

  it('deletes the need and records an audit entry when no active allocations remain', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.alertNeed.findUnique.mockResolvedValue(baseNeed as any);
    prisma.resourceAllocation.count.mockResolvedValue(0);
    prisma.alertNeed.delete.mockResolvedValue(baseNeed as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await DELETE(makeRequest('DELETE'), ctx);

    expect(res.status).toBe(200);
    expect(prisma.resourceAllocation.count).toHaveBeenCalledWith({
      where: { needId: 'need1', status: { notIn: ['RETURNED', 'CANCELLED'] } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ALERT_NEED_DELETE', entityId: 'need1' }) })
    );
  });
});
