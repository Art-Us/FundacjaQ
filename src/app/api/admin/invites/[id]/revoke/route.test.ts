import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', () => ({
  requireAdminOrCoordinator: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function baseInvite(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv1',
    email: 'volunteer@example.com',
    role: 'VOLUNTEER',
    createdById: 'coord-1',
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

function callRoute(id = 'inv1') {
  return POST(new Request('http://localhost'), { params: { id } });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('POST /api/admin/invites/[id]/revoke', () => {
  it('rejects with 403 and no DB write when there is no session', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await callRoute();

    expect(res.status).toBe(403);
    expect(prisma.inviteToken.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent invite', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(null);

    const res = await callRoute('missing');

    expect(res.status).toBe(404);
  });

  it('lets ADMIN revoke an invite created by someone else', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ createdById: 'coord-1' }) as any);
    prisma.inviteToken.update.mockResolvedValue({} as any);

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(prisma.inviteToken.update).toHaveBeenCalledWith({
      where: { id: 'inv1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('lets COORDINATOR revoke an invite they created', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ createdById: 'coord-1' }) as any);
    prisma.inviteToken.update.mockResolvedValue({} as any);

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(prisma.inviteToken.update).toHaveBeenCalled();
  });

  it('blocks COORDINATOR from revoking an invite created by someone else', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-2', role: 'COORDINATOR', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ createdById: 'coord-1' }) as any);

    const res = await callRoute();

    expect(res.status).toBe(403);
    expect(prisma.inviteToken.update).not.toHaveBeenCalled();
  });

  it('rejects revoking an already-used invite', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ usedAt: new Date() }) as any);

    const res = await callRoute();

    expect(res.status).toBe(400);
    expect(prisma.inviteToken.update).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-revoked invite (no error, no second write)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ revokedAt: new Date() }) as any);

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(prisma.inviteToken.update).not.toHaveBeenCalled();
  });
});