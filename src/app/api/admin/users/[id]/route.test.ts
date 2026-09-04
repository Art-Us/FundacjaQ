import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return {
    ...actual,
    requireAdmin: vi.fn(),
  };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { GET, PATCH, DELETE } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'target-1',
    email: 'target@example.com',
    role: 'VOLUNTEER',
    gminaId: 'gmina-1',
    isActive: true,
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/users/target-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callGet(id = 'target-1') {
  return GET(new Request('http://localhost'), { params: { id } });
}

function callPatch(body: unknown, id = 'target-1') {
  return PATCH(patchRequest(body), { params: { id } });
}

function callDelete(id = 'target-1') {
  return DELETE(new Request('http://localhost'), { params: { id } });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/users/[id]', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(403);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await callGet('missing');

    expect(res.status).toBe(404);
  });

  it('returns the user for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.id).toBe('target-1');
  });
});

describe('PATCH /api/admin/users/[id]', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callPatch({ name: 'New Name' });

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await callPatch({ name: 'New Name' }, 'missing');

    expect(res.status).toBe(404);
  });

  it('lets ADMIN update role/gmina/profile fields for another user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ role: 'COORDINATOR', gminaId: 'gmina-2', name: 'Jan' });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'target-1' },
        data: expect.objectContaining({ role: 'COORDINATOR', gminaId: 'gmina-2', name: 'Jan' }),
      })
    );
  });

  it('stamps lastActivatedAt when isActive is set to true', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ isActive: false }) as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ isActive: true });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: true, lastActivatedAt: expect.any(Date) }),
      })
    );
  });

  it('stamps lastDeactivatedAt and stores the reason when isActive is set to false for another user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ isActive: false, deactivationReason: 'Naruszenie regulaminu' });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          lastDeactivatedAt: expect.any(Date),
          deactivationReason: 'Naruszenie regulaminu',
        }),
      })
    );
  });

  it('blocks an ADMIN from deactivating their own account', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-1' }) as any);

    const res = await callPatch({ isActive: false }, 'admin-1');

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lets an ADMIN edit their own non-activation fields', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-1' }) as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ name: 'New Name' }, 'admin-1');

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('rejects a new email that collides with another account', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique
      .mockResolvedValueOnce(baseUser() as any)
      .mockResolvedValueOnce({ id: 'other-user' } as any);

    const res = await callPatch({ email: 'taken@example.com' });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a role outside the enum before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);

    const res = await callPatch({ role: 'SUPERADMIN' });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/users/[id]', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callDelete();

    expect(res.status).toBe(403);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('blocks an ADMIN from deleting their own account without a DB lookup', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await callDelete('admin-1');

    expect(res.status).toBe(403);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await callDelete('missing');

    expect(res.status).toBe(404);
  });

  it('lets ADMIN delete another user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.delete.mockResolvedValue({} as any);

    const res = await callDelete();

    expect(res.status).toBe(200);
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
  });

  it('returns 409 when the user has related records blocking deletion', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.delete.mockRejectedValue(new Error('Foreign key constraint failed'));

    const res = await callDelete();

    expect(res.status).toBe(409);
  });
});
