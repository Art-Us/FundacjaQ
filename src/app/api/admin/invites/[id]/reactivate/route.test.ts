import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', () => ({
  requireAdminOrCoordinator: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({
  consumeLimit: vi.fn(),
  inviteCreateLimiter: {},
}));
vi.mock('@/lib/email', () => ({
  sendInviteEmail: vi.fn(),
  isEmailConfigured: false,
}));
vi.mock('@/lib/adminEvents', () => ({
  publishAdminEvent: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { consumeLimit } from '@/lib/rateLimit';
import { sendInviteEmail } from '@/lib/email';
import { publishAdminEvent } from '@/lib/adminEvents';
import { POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function baseInvite(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv1',
    email: 'volunteer@example.com',
    role: 'VOLUNTEER',
    createdById: 'coord-1',
    usedAt: null,
    revokedAt: new Date(),
    expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    ...overrides,
  };
}

function callRoute(id = 'inv1') {
  return POST(new Request('http://localhost'), { params: { id } });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
  vi.mocked(consumeLimit).mockReset().mockResolvedValue(true);
  vi.mocked(sendInviteEmail).mockReset().mockResolvedValue(undefined);
  vi.mocked(publishAdminEvent).mockReset().mockResolvedValue(undefined);
});

describe('POST /api/admin/invites/[id]/reactivate', () => {
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

  it('lets ADMIN reactivate a revoked invite created by someone else', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ createdById: 'coord-1' }) as any);
    prisma.inviteToken.update.mockResolvedValue(baseInvite({ revokedAt: null }) as any);

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.inviteToken.update).toHaveBeenCalledWith({
      where: { id: 'inv1' },
      data: { tokenHash: expect.any(String), expiresAt: expect.any(Date), revokedAt: null },
    });
    expect(body.inviteUrl).toContain('/invite/');
    expect(sendInviteEmail).toHaveBeenCalled();
  });

  it('lets COORDINATOR reactivate an expired invite they created', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(
      baseInvite({ createdById: 'coord-1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) }) as any
    );
    prisma.inviteToken.update.mockResolvedValue({} as any);

    const res = await callRoute();

    expect(res.status).toBe(200);
    expect(prisma.inviteToken.update).toHaveBeenCalled();
  });

  it('blocks COORDINATOR from reactivating an invite created by someone else', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-2', role: 'COORDINATOR', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ createdById: 'coord-1' }) as any);

    const res = await callRoute();

    expect(res.status).toBe(403);
    expect(prisma.inviteToken.update).not.toHaveBeenCalled();
  });

  it('rejects reactivating an already-used invite', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ usedAt: new Date() }) as any);

    const res = await callRoute();

    expect(res.status).toBe(400);
    expect(prisma.inviteToken.update).not.toHaveBeenCalled();
  });

  it('rejects reactivating an invite that is still active (not revoked, not expired)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(
      baseInvite({ revokedAt: null, expiresAt: new Date(Date.now() + 60 * 60 * 1000) }) as any
    );

    const res = await callRoute();

    expect(res.status).toBe(400);
    expect(prisma.inviteToken.update).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-user invite rate limit is exceeded', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    vi.mocked(consumeLimit).mockResolvedValue(false);

    const res = await callRoute();

    expect(res.status).toBe(429);
    expect(prisma.inviteToken.findUnique).not.toHaveBeenCalled();
  });

  it('returns a clean 500 (not an unhandled crash) when the update fails', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite() as any);
    prisma.inviteToken.update.mockRejectedValue(new Error('connection lost'));

    const res = await callRoute();

    expect(res.status).toBe(500);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('generates a fresh token that does not match the invite\'s previous stored hash', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ tokenHash: 'old-hash' }) as any);
    prisma.inviteToken.update.mockResolvedValue({} as any);

    await callRoute();

    const updateCall = prisma.inviteToken.update.mock.calls[0][0] as any;
    expect(updateCall.data.tokenHash).not.toBe('old-hash');
  });
});
