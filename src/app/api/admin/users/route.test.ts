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
vi.mock('@/lib/password', async () => {
  const actual = await vi.importActual<typeof import('@/lib/password')>('@/lib/password');
  return {
    ...actual,
    hashPassword: vi.fn(),
    isPasswordPwned: vi.fn(),
  };
});

import { prisma as prismaImport } from '@/lib/prisma';
// Imported by its real path purely so vi.mock('@/lib/prisma') (resolved via
// this project's __mocks__/prisma.ts) and this specifier refer to the same
// on-disk module at runtime.
import { installTransactionMock } from '@/lib/__mocks__/prisma';
import { requireAdmin } from '@/lib/authz';
import { hashPassword, isPasswordPwned } from '@/lib/password';
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const STRONG_PASSWORD = 'CorrectHorseBattery9!';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockReset(prisma);
  // mockReset wipes the $transaction implementation the shared mock installs
  // at module load — POST runs the organization re-check + user.create
  // through prisma.$transaction(async (tx) => ...), so it must be
  // reinstalled here (see the doc comment on installTransactionMock).
  installTransactionMock(prisma);
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(hashPassword).mockReset().mockResolvedValue('hashed');
  vi.mocked(isPasswordPwned).mockReset().mockResolvedValue(false);
});

describe('GET /api/admin/users', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('returns the user list for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }] as any);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users).toHaveLength(1);
  });
});

describe('POST /api/admin/users', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await POST(makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER' }));

    expect(res.status).toBe(403);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates the user as inactive, hashing the password', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1' } as any);

    const res = await POST(
      makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER', gminaId: 'g1' })
    );

    expect(res.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@example.com',
          passwordHash: 'hashed',
          role: 'VOLUNTEER',
          gminaId: 'g1',
          isActive: false,
        }),
      })
    );
  });

  it('rejects a duplicate email with 400 and does not create a user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' } as any);

    const res = await POST(
      makeRequest({ email: 'existing@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER', gminaId: 'g1' })
    );

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('reports "email already registered" specifically for a real unique-constraint race (P2002)', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      })
    );

    const res = await POST(
      makeRequest({ email: 'race@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER', gminaId: 'g1' })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Konto dla tego adresu email już istnieje.');
  });

  it('surfaces a generic error (not "email already registered") for an unrelated DB failure', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(new Error('connection lost'));

    const res = await POST(
      makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER', gminaId: 'g1' })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).not.toContain('już istnieje');
  });

  it('rejects a password found in a breach database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(isPasswordPwned).mockResolvedValue(true);

    const res = await POST(
      makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER', gminaId: 'g1' })
    );

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('requires a gmina when creating a COORDINATOR/VOLUNTEER without one', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER' }));

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not require a gmina when creating an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1' } as any);

    const res = await POST(makeRequest({ email: 'new-admin@example.com', password: STRONG_PASSWORD, role: 'ADMIN' }));

    expect(res.status).toBe(201);
  });

  it('rejects a role outside the enum before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'SUPERADMIN' }));

    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a weak password before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ email: 'new@example.com', password: 'short1!', role: 'VOLUNTEER' }));

    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  // Regression coverage: the "+ Nowa gmina" inline flow creates a real Gmina
  // row via resolveGminaId/createGmina — that used to be invisible to the
  // audit log (only the dedicated POST /api/admin/gminas route logged it).
  it('logs a GMINA_CREATE audit entry when the request creates a new gmina inline', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({ id: 'new-gmina', name: 'Nowa Gmina' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1', gminaId: 'new-gmina' } as any);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        newGminaName: 'Nowa Gmina',
      })
    );

    expect(res.status).toBe(201);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'GMINA_CREATE', entityType: 'GMINA', entityId: 'new-gmina' }),
      })
    );
  });

  it('rejects assigning an organization that does not exist', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findUnique.mockResolvedValue(null);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        gminaId: 'g1',
        organizationId: 'missing-org',
      })
    );

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // Regression coverage: Organization is itself gmina-scoped
  // (@@unique([name, gminaId])), so a user ending up in a DIFFERENT gmina
  // than their assigned organization silently breaks that scoping for every
  // view/report that joins a user through their organization — this must be
  // rejected, not merely checked for existence.
  it('rejects assigning an organization that belongs to a different gmina than the user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'g2' } as any);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        gminaId: 'g1',
        organizationId: 'org-1',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('innej gminy');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // Regression coverage: ADMIN doesn't require a gmina (requiresGmina('ADMIN')
  // is false), so effectiveGminaId can stay undefined for an ADMIN create —
  // the mismatch check must still fire in that case instead of being skipped,
  // otherwise the created user ends up with an organizationId pointing at a
  // gmina-scoped org while the user itself has no gmina at all, a state
  // PATCH /api/admin/users/[id] would then reject on every future edit.
  it('rejects assigning an organization when the resulting user has no gmina at all (e.g. ADMIN + organizationId)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'g1' } as any);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'ADMIN',
        organizationId: 'org-1',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('innej gminy');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('accepts an organization that belongs to the SAME gmina as the user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1' } as any);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        gminaId: 'g1',
        organizationId: 'org-1',
      })
    );

    expect(res.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-1' }) })
    );
  });

  // Regression coverage for the org/gmina TOCTOU race: the organization is
  // checked once before the (slow, external) isPasswordPwned call, then
  // re-checked immediately before the actual write inside the transaction.
  // If a concurrent PATCH /api/admin/organizations/[id] reassigns the org's
  // gmina in that window, the second read must catch it and abort the create.
  it('aborts with 409 when the organization changes gmina between the precheck and the write', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findUnique
      .mockResolvedValueOnce({ id: 'org-1', gminaId: 'g1' } as any)
      .mockResolvedValueOnce({ id: 'org-1', gminaId: 'g2' } as any);
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        gminaId: 'g1',
        organizationId: 'org-1',
      })
    );

    expect(res.status).toBe(409);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not log a GMINA_CREATE entry when an existing gmina is reused by name', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findFirst.mockResolvedValue({ id: 'existing-gmina', name: 'Istniejąca' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1', gminaId: 'existing-gmina' } as any);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        newGminaName: 'Istniejąca',
      })
    );

    expect(res.status).toBe(201);
    expect(prisma.gmina.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'GMINA_CREATE' }) })
    );
  });
});
