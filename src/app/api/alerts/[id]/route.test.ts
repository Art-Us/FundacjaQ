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

const baseAlert = {
  id: 'a1',
  gminaId: 'g1',
  organizationId: 'owner-org',
  status: 'ACTIVE',
  kind: 'ALERT',
};

function makeRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/alerts/a1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'a1' } };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('PATCH /api/alerts/[id]', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ title: 'Nowy tytuł' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the alert does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ title: 'Nowy tytuł' }), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a COORDINATOR from a different gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'other-gmina' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await PATCH(makeRequest({ title: 'Nowy tytuł' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('rejects an empty body', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await PATCH(makeRequest({}), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('updates a non-status field without touching the allocations gate', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alert.update.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ title: 'Zaktualizowany tytuł' }), ctx);

    expect(res.status).toBe(200);
    expect(prisma.resourceAllocation.count).not.toHaveBeenCalled();
  });

  it('blocks the OWNER organization from cancelling directly when active allocations exist (Крок 29)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceAllocation.count.mockResolvedValue(1);

    const res = await PATCH(makeRequest({ status: 'CANCELLED' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('USE_CANCEL_WITH_RETURN');
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('allows the OWNER organization to cancel directly once no active allocations remain', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceAllocation.count.mockResolvedValue(0);
    prisma.alert.update.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'CANCELLED' }), ctx);

    expect(res.status).toBe(200);
    expect(prisma.alert.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'CANCELLED' } });
  });

  it("allows ADMIN to cancel another org's alert directly even with active allocations (нюанс #5)", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alert.update.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'CANCELLED' }), ctx);

    expect(res.status).toBe(200);
    expect(prisma.resourceAllocation.count).not.toHaveBeenCalled();
    expect(prisma.alert.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'CANCELLED' } });
  });

  it('does not re-trigger the gate when the alert is already CANCELLED', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue({ ...baseAlert, status: 'CANCELLED' } as any);
    prisma.alert.update.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest({ status: 'CANCELLED' }), ctx);

    expect(res.status).toBe(200);
    expect(prisma.resourceAllocation.count).not.toHaveBeenCalled();
  });
});
