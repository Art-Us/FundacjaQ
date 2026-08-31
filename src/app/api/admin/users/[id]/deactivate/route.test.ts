import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return {
    ...actual,
    requireAdminOrCoordinator: vi.fn(),
  };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'target-1',
    role: 'VOLUNTEER',
    gminaId: 'gmina-1',
    isActive: true,
    ...overrides,
  };
}

function callRoute(id = 'target-1') {
  return POST(new Request('http://localhost'), { params: { id } });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('POST /api/admin/users/[id]/deactivate', () => {
  it('rejects with 403 and no DB write when there is no session', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await callRoute();

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent user', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await callRoute('missing');

    expect(res.status).toBe(404);
  });

  it('lets ADMIN deactivate any user', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ gminaId: 'other-gmina' }) as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { isActive: false },
    });
  });

  it('lets COORDINATOR deactivate a VOLUNTEER in their own gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: 'gmina-1' });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("blocks COORDINATOR from deactivating a VOLUNTEER in another gmina", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: 'gmina-1' });
    prisma.user.findUnique.mockResolvedValue(baseUser({ gminaId: 'gmina-2' }) as any);

    const res = await callRoute();

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('blocks COORDINATOR from deactivating another COORDINATOR in their own gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: 'gmina-1' });
    prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'coord-2', role: 'COORDINATOR' }) as any);

    const res = await callRoute('coord-2');

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('blocks a user from deactivating their own account', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-1', role: 'ADMIN' }) as any);

    const res = await callRoute('admin-1');

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-inactive user (no error, no second write)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ isActive: false }) as any);

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
