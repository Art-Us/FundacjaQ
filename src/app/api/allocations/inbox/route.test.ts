import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdminOrCoordinator: vi.fn() };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { GET } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('GET /api/allocations/inbox', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.findMany).not.toHaveBeenCalled();
  });

  it('returns empty sections with no DB call for a caller with no organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ recipient: [], donor: [] });
    expect(prisma.resourceAllocation.findMany).not.toHaveBeenCalled();
  });

  it('queries the recipient section scoped to the org owning the alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'my-org' });
    prisma.resourceAllocation.findMany.mockResolvedValue([]);

    await GET();

    expect(prisma.resourceAllocation.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          alert: { organizationId: 'my-org', status: { in: ['CANCELLED', 'RESOLVED'] } },
          status: { notIn: ['RETURNED', 'CANCELLED'] },
        },
      })
    );
  });

  it('queries the donor section scoped to donorOrgId, independent of alert ownership', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'my-org' });
    prisma.resourceAllocation.findMany.mockResolvedValue([]);

    await GET();

    expect(prisma.resourceAllocation.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          donorOrgId: 'my-org',
          alert: { status: { in: ['CANCELLED', 'RESOLVED'] } },
          status: { notIn: ['RETURNED', 'CANCELLED'] },
        },
      })
    );
  });

  it('returns both sections with their respective allocations, including return events', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'my-org' });
    const recipientRow = { id: 'alloc1', returnEvents: [{ message: 'Zwrócono częściowo' }] };
    const donorRow = { id: 'alloc2', returnEvents: [] };
    prisma.resourceAllocation.findMany.mockResolvedValueOnce([recipientRow] as any).mockResolvedValueOnce([donorRow] as any);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.recipient).toEqual([recipientRow]);
    expect(body.donor).toEqual([donorRow]);
  });
});
