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
    requireAdminOrCoordinator: vi.fn(),
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
import { requireAdmin, requireAdminOrCoordinator } from '@/lib/authz';
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

function callGet(query = '') {
  return GET(new NextRequest(`http://localhost/api/admin/users${query}`));
}

beforeEach(() => {
  mockReset(prisma);
  // mockReset wipes the $transaction implementation the shared mock installs
  // at module load — POST runs the organization re-check + user.create
  // through prisma.$transaction(async (tx) => ...), so it must be
  // reinstalled here (see the doc comment on installTransactionMock).
  installTransactionMock(prisma);
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(requireAdminOrCoordinator).mockReset();
  vi.mocked(hashPassword).mockReset().mockResolvedValue('hashed');
  vi.mocked(isPasswordPwned).mockReset().mockResolvedValue(false);
});

describe('GET /api/admin/users', () => {
  it('returns 403 with no DB call when the caller is neither ADMIN nor COORDINATOR', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('returns a paginated user list for an ADMIN session, unscoped by gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', role: 'VOLUNTEER', gminaId: 'g1' }] as any);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(30);
    expect(body.totalPages).toBe(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, skip: 0, take: 30 })
    );
  });

  it("computes isSelf and canManage per row for the requesting actor", async () => {
    const actor = { id: 'admin-1', role: 'ADMIN', gminaId: null };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(actor);
    prisma.user.count.mockResolvedValue(2);
    prisma.user.findMany.mockResolvedValue([
      { id: 'admin-1', role: 'ADMIN', gminaId: null },
      { id: 'u2', role: 'VOLUNTEER', gminaId: 'g1' },
    ] as any);

    const res = await callGet();
    const body = await res.json();

    expect(body.users[0]).toMatchObject({ id: 'admin-1', isSelf: true, canManage: false });
    expect(body.users[1]).toMatchObject({ id: 'u2', isSelf: false, canManage: true });
  });

  // Regression coverage: a coordinator with no organization of their own must
  // see NOTHING, never silently fall back to "no restriction" (which would
  // leak every organization's users to them) — same fail-closed contract the
  // 2026-09-10 audit required of gmina scoping, now enforced by organization
  // instead (see scopedOrganizationWhere in lib/organization.ts).
  it('returns an empty page with no DB call for a coordinator with no organization of their own', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({
      id: 'coord-1',
      role: 'COORDINATOR',
      gminaId: 'gmina-1',
      organizationId: null,
    });

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ users: [], total: 0, page: 1, pageSize: 30, totalPages: 0 });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it("scopes a coordinator's results to their own organization", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({
      id: 'coord-1',
      role: 'COORDINATOR',
      gminaId: 'gmina-1',
      organizationId: 'org-1',
    });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) })
    );
  });

  it('applies page/pageSize as skip/take', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(100);
    prisma.user.findMany.mockResolvedValue([]);

    const res = await callGet('?page=3&pageSize=10');
    const body = await res.json();

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(body.totalPages).toBe(10);
  });

  it('defaults to sorting by createdAt descending', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })
    );
  });

  // Regression coverage: sorting must be a real DB ORDER BY, not a
  // client-side Array.sort over whatever page happened to load — otherwise
  // it would only ever reorder the current 30 rows instead of the whole
  // (filtered) directory.
  it.each([
    ['createdAt', 'asc', { createdAt: 'asc' }],
    ['lastActivatedAt', 'desc', { lastActivatedAt: 'desc' }],
    ['lastActivatedAt', 'asc', { lastActivatedAt: 'asc' }],
    ['lastDeactivatedAt', 'desc', { lastDeactivatedAt: 'desc' }],
    ['lastDeactivatedAt', 'asc', { lastDeactivatedAt: 'asc' }],
    ['name', 'asc', { name: 'asc' }],
    ['name', 'desc', { name: 'desc' }],
  ] as const)('sorts by %s %s', async (sortBy, sortDir, expectedPrimary) => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet(`?sortBy=${sortBy}&sortDir=${sortDir}`);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [expectedPrimary, { id: 'asc' }] })
    );
  });

  it('rejects an invalid sortBy/sortDir before querying the DB', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await callGet('?sortBy=passwordHash&sortDir=asc');

    expect(res.status).toBe(400);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('applies role/status/onlyPending as exact filters', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet('?role=COORDINATOR&status=INACTIVE&onlyPending=true');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'COORDINATOR', isActive: false, lastActivatedAt: null }),
      })
    );
  });

  it('applies an ADMIN-supplied gminaId filter', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet('?gminaId=gmina-9');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ gminaId: 'gmina-9' }) })
    );
  });

  it('applies an ADMIN-supplied organizationId filter', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet('?organizationId=org-1');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) })
    );
  });

  // Regression coverage: `organizationId` is the exact same key
  // scopedOrganizationWhere() uses for a coordinator's own fail-closed scope
  // — spreading a client-supplied organizationId AFTER that scope (or in any
  // order that lets it win) would let a coordinator override their own
  // restriction and read another organization's users entirely. It must be
  // silently ignored for anyone but ADMIN, not merely validated. gminaId is
  // no longer a coordinator scoping key at all, so it's ignored for them too.
  it('ignores client-supplied gminaId/organizationId for a COORDINATOR instead of letting them override their own organization scope', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({
      id: 'coord-1',
      role: 'COORDINATOR',
      gminaId: 'gmina-1',
      organizationId: 'org-1',
    });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet('?gminaId=someone-elses-gmina&organizationId=someone-elses-org');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1' }),
      })
    );
    const call = prisma.user.findMany.mock.calls[0][0] as any;
    expect(call.where.gminaId).toBeUndefined();
  });

  // Regression coverage: search used to be a client-side filter over an
  // already-capped 200-row list — now it's a DB query covering the whole
  // (filtered) directory, including a translated match against the
  // role/status LABELS a user would actually type (e.g. "administrator"),
  // not just raw column values.
  it('builds a free-text OR search across name/email/phone/deactivation reason/organization/gmina, plus role and status labels', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet('?q=administrator');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { name: { contains: 'administrator', mode: 'insensitive' } },
            { email: { contains: 'administrator', mode: 'insensitive' } },
            { role: { in: ['ADMIN'] } },
          ]),
        }),
      })
    );
  });

  it('escapes LIKE wildcard characters in q so they match literally', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet('?q=jan_kowalski');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ email: { contains: 'jan\\_kowalski', mode: 'insensitive' } }]),
        }),
      })
    );
  });

  it('ignores a blank q instead of matching every row', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await callGet('?q=%20%20');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ OR: expect.anything() }) })
    );
  });

  it('returns 500 (not an unhandled crash) when the DB call fails', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.count.mockRejectedValue(new Error('connection lost'));

    const res = await callGet();

    expect(res.status).toBe(500);
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

  it('requires an organization when creating a COORDINATOR/VOLUNTEER without one', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);

    const res = await POST(
      makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER', gminaId: 'g1' })
    );

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not require an organization when creating an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1' } as any);

    const res = await POST(makeRequest({ email: 'new-admin2@example.com', password: STRONG_PASSWORD, role: 'ADMIN' }));

    expect(res.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalled();
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
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      })
    );

    const res = await POST(
      makeRequest({
        email: 'race@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        gminaId: 'g1',
        organizationId: 'org-1',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Konto dla tego adresu email już istnieje.');
  });

  it('surfaces a generic error (not "email already registered") for an unrelated DB failure', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(new Error('connection lost'));

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
    expect(body.error).not.toContain('już istnieje');
  });

  it('rejects a password found in a breach database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'g1' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(isPasswordPwned).mockResolvedValue(true);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        gminaId: 'g1',
        organizationId: 'org-1',
      })
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
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'new-gmina' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1', gminaId: 'new-gmina' } as any);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        newGminaName: 'Nowa Gmina',
        organizationId: 'org-1',
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
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', gminaId: 'existing-gmina' } as any);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1', gminaId: 'existing-gmina' } as any);

    const res = await POST(
      makeRequest({
        email: 'new@example.com',
        password: STRONG_PASSWORD,
        role: 'VOLUNTEER',
        newGminaName: 'Istniejąca',
        organizationId: 'org-1',
      })
    );

    expect(res.status).toBe(201);
    expect(prisma.gmina.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'GMINA_CREATE' }) })
    );
  });
});
