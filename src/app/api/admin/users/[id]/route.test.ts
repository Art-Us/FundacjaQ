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
vi.mock('@/lib/userStatusCache', () => ({
  invalidateUserStatusCache: vi.fn(),
}));
vi.mock('@/lib/adminEvents', () => ({
  publishAdminEvent: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { installTransactionMock } from '@/lib/__mocks__/prisma';
import { requireAdmin } from '@/lib/authz';
import { invalidateUserStatusCache } from '@/lib/userStatusCache';
import { publishAdminEvent } from '@/lib/adminEvents';
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
  // mockReset wipes the $transaction implementation the shared mock installs
  // at module load — PATCH runs the organization re-check + user.update
  // through prisma.$transaction(async (tx) => ...), so it must be
  // reinstalled here (see the doc comment on installTransactionMock).
  installTransactionMock(prisma);
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(invalidateUserStatusCache).mockReset().mockResolvedValue(undefined);
  vi.mocked(publishAdminEvent).mockReset().mockResolvedValue(undefined);
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

  describe('gmina-scoped admin actor', () => {
    it('can view a user in their own gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'gadmin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ gminaId: 'gmina-1' }) as any);

      const res = await callGet();

      expect(res.status).toBe(200);
    });

    it('can view their own profile', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'gadmin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'gadmin-1', role: 'ADMIN', gminaId: 'gmina-1' }) as any);

      const res = await callGet('gadmin-1');

      expect(res.status).toBe(200);
    });

    it('rejects (403) viewing a user in a DIFFERENT gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'gadmin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ gminaId: 'other-gmina' }) as any);

      const res = await callGet();

      expect(res.status).toBe(403);
    });

    it('rejects (403) viewing a GLOBAL admin', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'gadmin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'global-admin-1', role: 'ADMIN', gminaId: null }) as any);

      const res = await callGet('global-admin-1');

      expect(res.status).toBe(403);
    });
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

  it('blocks deactivating the only remaining active admin (another admin acting on them)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-2', role: 'ADMIN', isActive: true }) as any);
    prisma.user.count.mockResolvedValue(1);

    const res = await callPatch({ isActive: false }, 'admin-2');

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows deactivating an admin when another active admin remains', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-2', role: 'ADMIN', isActive: true }) as any);
    prisma.user.count.mockResolvedValue(2);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ isActive: false }, 'admin-2');

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  // Regression coverage: the last-admin guard used to only fire on an
  // explicit isActive:false — a role change away from ADMIN (with isActive
  // left true/untouched) has the exact same effect on the active-admin count
  // and went completely unchecked.
  it('blocks demoting the only remaining active admin\'s role away from ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(
      baseUser({ id: 'admin-2', role: 'ADMIN', isActive: true, gminaId: 'gmina-1' }) as any
    );
    prisma.user.count.mockResolvedValue(1);

    const res = await callPatch({ role: 'COORDINATOR' }, 'admin-2');

    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows demoting an admin\'s role when another active admin remains', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(
      baseUser({ id: 'admin-2', role: 'ADMIN', isActive: true, gminaId: 'gmina-1' }) as any
    );
    prisma.user.count.mockResolvedValue(2);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ role: 'COORDINATOR' }, 'admin-2');

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalled();
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

  it('reports "email already registered" specifically for a real unique-constraint race (P2002)', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValueOnce(baseUser() as any).mockResolvedValueOnce(null);
    prisma.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      })
    );

    const res = await callPatch({ email: 'race@example.com' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Konto dla tego adresu email już istnieje.');
  });

  it('surfaces a generic error (not "email already registered") for an unrelated DB failure', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.update.mockRejectedValue(new Error('connection lost'));

    const res = await callPatch({ name: 'New Name' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).not.toContain('już istnieje');
  });

  it('rejects a role outside the enum before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);

    const res = await callPatch({ role: 'SUPERADMIN' });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('creates a new gmina by name and assigns it when newGminaName is given, logging its own GMINA_CREATE audit entry', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({ id: 'new-gmina', name: 'Gmina Test' } as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ newGminaName: 'Gmina Test' });

    expect(res.status).toBe(200);
    expect(prisma.gmina.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Gmina Test' } }));
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gminaId: 'new-gmina' }) })
    );
    // Regression coverage: this inline "+ Nowa gmina" creation used to be
    // invisible to the audit log — only the dedicated gmina-management CRUD
    // route logged GMINA_CREATE.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'GMINA_CREATE', entityType: 'GMINA', entityId: 'new-gmina' }),
      })
    );
  });

  // Regression coverage for the 2026-09-10 audit finding: a PATCH that
  // silently detached a COORDINATOR/VOLUNTEER from their gmina made them
  // invisible to gmina-scoped queries (lib/gmina.ts scopedGminaWhere treats
  // "gmina-scoped role, no gmina" as "return nothing"), which is a functional
  // regression even though it isn't itself a privilege escalation.
  it('rejects explicitly clearing gminaId on a VOLUNTEER (would leave a gmina-scoped role with no gmina)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'VOLUNTEER', gminaId: 'gmina-1' }) as any);

    const res = await callPatch({ gminaId: null });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects changing role to COORDINATOR when the target has no gmina and none is supplied', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'ADMIN', gminaId: null }) as any);

    const res = await callPatch({ role: 'COORDINATOR' });

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects assigning an organization that belongs to a different gmina than the user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ gminaId: 'gmina-1' }) as any);
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'gmina-2' } as any);

    const res = await callPatch({ organizationId: 'org-1' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('innej gminy');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('accepts assigning an organization that belongs to the SAME gmina as the user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ gminaId: 'gmina-1' }) as any);
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'gmina-1' } as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ organizationId: 'org-1' });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-1' }) })
    );
  });

  // Regression coverage for the org/gmina TOCTOU race: the organization is
  // re-checked immediately before the write, inside the transaction, so a
  // concurrent PATCH /api/admin/organizations/[id] reassigning its gmina in
  // between the precheck and the write is caught rather than silently
  // producing a mismatched user/organization pair.
  it('aborts with 409 when the organization changes gmina between the precheck and the write', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ gminaId: 'gmina-1' }) as any);
    prisma.organization.findUnique
      .mockResolvedValueOnce({ id: 'org-1', gminaId: 'gmina-1' } as any)
      .mockResolvedValueOnce({ id: 'org-1', gminaId: 'gmina-2' } as any);

    const res = await callPatch({ organizationId: 'org-1' });

    expect(res.status).toBe(409);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // Regression coverage: even when THIS request doesn't touch
  // organizationId at all, reassigning the user to a different gmina can
  // leave their PRE-EXISTING organization mismatched — the check must use
  // the resulting (effective) organization, not just a freshly-submitted one.
  it('rejects reassigning gminaId when it would leave the user\'s existing organization mismatched', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(
      baseUser({ gminaId: 'gmina-1', organizationId: 'org-1' }) as any
    );
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'gmina-1' } as any);

    const res = await callPatch({ gminaId: 'gmina-2' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('innej gminy');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows clearing gminaId when the resulting role is ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'ADMIN', gminaId: 'gmina-1' }) as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await callPatch({ gminaId: null });

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gminaId: null }) })
    );
  });

  // Gmina-scoped admin: same capabilities as a global admin, but confined to
  // their own gmina, and never touching a global admin's account.
  describe('gmina-scoped admin actor', () => {
    it('can edit a non-admin user in their own gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'VOLUNTEER', gminaId: 'gmina-1' }) as any);
      prisma.user.update.mockResolvedValue({} as any);

      const res = await callPatch({ name: 'New Name' });

      expect(res.status).toBe(200);
    });

    it('rejects (403) editing a user in a DIFFERENT gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'VOLUNTEER', gminaId: 'gmina-2' }) as any);

      const res = await callPatch({ name: 'New Name' });

      expect(res.status).toBe(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects (403) editing a GLOBAL admin, even non-sensitive fields', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'global-admin-1', role: 'ADMIN', gminaId: null }) as any);

      const res = await callPatch({ name: 'New Name' }, 'global-admin-1');

      expect(res.status).toBe(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('can edit a peer gmina-scoped admin in the SAME gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-2', role: 'ADMIN', gminaId: 'gmina-1' }) as any);
      prisma.user.update.mockResolvedValue({} as any);

      const res = await callPatch({ name: 'New Name' }, 'admin-2');

      expect(res.status).toBe(200);
    });

    it('can still edit their own non-activation fields', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' }) as any);
      prisma.user.update.mockResolvedValue({} as any);

      const res = await callPatch({ name: 'New Name' }, 'admin-1');

      expect(res.status).toBe(200);
    });

    it('rejects (403) promoting a non-admin target to ADMIN', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'VOLUNTEER', gminaId: 'gmina-1' }) as any);

      const res = await callPatch({ role: 'ADMIN' });

      expect(res.status).toBe(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    // The escalation this specifically guards against: role stays 'ADMIN'
    // throughout (so the "promote to ADMIN" check never fires), but clearing
    // gminaId on an already-ADMIN target — including the actor's OWN account
    // — would silently turn it into an unrestricted global admin.
    it('rejects (403) clearing gminaId (null) on an ADMIN target, including their own account', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' }) as any);

      const res = await callPatch({ gminaId: null }, 'admin-1');

      expect(res.status).toBe(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects (403) reassigning a target to a DIFFERENT gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'VOLUNTEER', gminaId: 'gmina-1' }) as any);

      const res = await callPatch({ gminaId: 'gmina-2' });

      expect(res.status).toBe(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects (403) the inline "+ Nowa gmina" flow (newGminaName)', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'VOLUNTEER', gminaId: 'gmina-1' }) as any);

      const res = await callPatch({ newGminaName: 'Brand New Gmina' });

      expect(res.status).toBe(403);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
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

  it('blocks deleting the only remaining active admin', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-2', role: 'ADMIN', isActive: true }) as any);
    prisma.user.count.mockResolvedValue(1);

    const res = await callDelete('admin-2');

    expect(res.status).toBe(403);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('allows deleting an admin when another active admin remains', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'admin-2', role: 'ADMIN', isActive: true }) as any);
    prisma.user.count.mockResolvedValue(2);
    prisma.user.delete.mockResolvedValue({} as any);

    const res = await callDelete('admin-2');

    expect(res.status).toBe(200);
  });

  it('lets ADMIN delete another user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.delete.mockResolvedValue({} as any);

    const res = await callDelete();

    expect(res.status).toBe(200);
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
  });

  it('returns 409 when the user has related records blocking deletion (P2003)', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: '5.19.1',
      })
    );

    const res = await callDelete();

    expect(res.status).toBe(409);
  });

  it('returns 500 (not a false "has related records" 409) when delete fails for an unrelated reason', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(baseUser() as any);
    prisma.user.delete.mockRejectedValue(new Error('connection lost'));

    const res = await callDelete();

    expect(res.status).toBe(500);
  });

  describe('gmina-scoped admin actor', () => {
    it('can delete a non-admin user in their own gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'VOLUNTEER', gminaId: 'gmina-1' }) as any);
      prisma.user.delete.mockResolvedValue({} as any);

      const res = await callDelete();

      expect(res.status).toBe(200);
    });

    it('rejects (403) deleting a user in a DIFFERENT gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ role: 'VOLUNTEER', gminaId: 'gmina-2' }) as any);

      const res = await callDelete();

      expect(res.status).toBe(403);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('rejects (403) deleting a GLOBAL admin', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(baseUser({ id: 'global-admin-1', role: 'ADMIN', gminaId: null }) as any);

      const res = await callDelete('global-admin-1');

      expect(res.status).toBe(403);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('can delete a peer gmina-scoped admin in the SAME gmina (subject to the last-active-admin guard)', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.user.findUnique.mockResolvedValue(
        baseUser({ id: 'admin-2', role: 'ADMIN', gminaId: 'gmina-1', isActive: true }) as any
      );
      prisma.user.count.mockResolvedValue(2);
      prisma.user.delete.mockResolvedValue({} as any);

      const res = await callDelete('admin-2');

      expect(res.status).toBe(200);
    });
  });
});
