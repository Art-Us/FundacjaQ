import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock('@/lib/adminEvents', () => ({
  publishAdminEvent: vi.fn(),
}));
vi.mock('@/lib/userStatusCache', () => ({
  invalidateUserStatusCache: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { installTransactionMock } from '@/lib/__mocks__/prisma';
import { requireAdmin } from '@/lib/authz';
import { invalidateUserStatusCache } from '@/lib/userStatusCache';
import { PATCH, DELETE } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function baseOrganization(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'target-1',
    name: 'Caritas',
    street: null,
    houseNumber: null,
    apartmentNumber: null,
    city: null,
    postalCode: null,
    gminaId: 'g1',
    contactFirstName: null,
    contactLastName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/organizations/target-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  // at module load — PATCH runs organization.update (plus, on a gmina
  // reassignment, the cascading user.updateMany) through
  // prisma.$transaction(async (tx) => ...), so it must be reinstalled here
  // (see the doc comment on installTransactionMock).
  installTransactionMock(prisma);
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(invalidateUserStatusCache).mockReset().mockResolvedValue(undefined);
  // Default: no members to cascade. Tests that reassign gminaId and care
  // about the cascade override this with their own list.
  prisma.user.findMany.mockResolvedValue([]);
});

describe('PATCH /api/admin/organizations/[id]', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callPatch({ name: 'New Name' });

    expect(res.status).toBe(403);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent organization', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(null);

    const res = await callPatch({ name: 'New Name' }, 'missing');

    expect(res.status).toBe(404);
  });

  it('returns 500 when the initial organization lookup itself throws', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockRejectedValue(new Error('connection lost'));

    const res = await callPatch({ name: 'New Name' });

    expect(res.status).toBe(500);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed contactEmail', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);

    const res = await callPatch({ contactEmail: 'not-an-email' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Nieprawidłowy adres email kontaktu.');
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('accepts a valid, non-empty contactEmail', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    prisma.organization.update.mockResolvedValue({} as any);

    const res = await callPatch({ contactEmail: 'jan@example.com' });

    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { contactEmail: 'jan@example.com' },
    });
  });

  it('applies every optional address/contact field when provided with a real (non-null) value', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    prisma.organization.update.mockResolvedValue({} as any);

    const res = await callPatch({
      street: 'Długa',
      houseNumber: '12',
      apartmentNumber: '3A',
      city: 'Kraków',
      postalCode: '30-001',
      contactFirstName: 'Jan',
      contactLastName: 'Kowalski',
      contactPhone: '+48 600 100 200',
      contactEmail: 'jan@example.com',
    });

    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: {
        street: 'Długa',
        houseNumber: '12',
        apartmentNumber: '3A',
        city: 'Kraków',
        postalCode: '30-001',
        contactFirstName: 'Jan',
        contactLastName: 'Kowalski',
        contactPhone: '+48 600 100 200',
        contactEmail: 'jan@example.com',
      },
    });
  });

  it('updates fields for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    prisma.organization.update.mockResolvedValue({} as any);

    const res = await callPatch({ city: 'Kraków', postalCode: '30-001' });

    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { city: 'Kraków', postalCode: '30-001' },
    });
  });

  it('allows renaming to a name that only differs from itself by case/whitespace', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ name: 'Caritas' }) as any);
    prisma.organization.update.mockResolvedValue({} as any);

    const res = await callPatch({ name: '  caritas  ' });

    expect(res.status).toBe(200);
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { name: 'caritas' },
    });
  });

  it('rejects renaming to a name already used by another organization in the SAME gmina', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ name: 'Caritas' }) as any);
    prisma.organization.findFirst.mockResolvedValue({ id: 'other-org', name: 'PCK', gminaId: 'g1' } as any);

    const res = await callPatch({ name: 'PCK' });

    expect(res.status).toBe(409);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('allows the SAME name when reassigned to a different gmina (uniqueness is per-gmina, not global)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ name: 'Caritas', gminaId: 'g1' }) as any);
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g2' } as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.update.mockResolvedValue({} as any);

    const res = await callPatch({ gminaId: 'g2' });

    expect(res.status).toBe(200);
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: { gminaId: 'g2', name: { equals: 'Caritas', mode: 'insensitive' } },
    });
  });

  // Regression coverage: every current user of an organization has their own
  // gminaId set to that organization's CURRENT gmina. Reassigning the org's
  // gmina now takes its members along with it — a single updateMany, in the
  // same transaction as the org's own write — instead of being blocked,
  // so that invariant never goes stale.
  it('cascades the new gminaId onto every user still assigned to the organization', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g2' } as any);
    prisma.organization.update.mockResolvedValue(baseOrganization({ gminaId: 'g2' }) as any);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }] as any);

    const res = await callPatch({ gminaId: 'g2' });

    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gmina: { connect: { id: 'g2' } } }) })
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'target-1' },
      data: { gminaId: 'g2' },
    });
    // Every session-revalidation write site must invalidate this cache — see
    // the doc comment on invalidateUserStatusCache — otherwise a moved
    // member's session keeps scoping requests to their OLD gmina for up to
    // its 2-minute TTL.
    expect(invalidateUserStatusCache).toHaveBeenCalledWith('user-1');
    expect(invalidateUserStatusCache).toHaveBeenCalledWith('user-2');
  });

  it('allows reassigning gminaId when the organization has no users assigned', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g2' } as any);
    prisma.organization.update.mockResolvedValue({} as any);

    const res = await callPatch({ gminaId: 'g2' });

    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gmina: { connect: { id: 'g2' } } }) })
    );
  });

  it('does not touch users when the update leaves gminaId unchanged', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);
    prisma.organization.update.mockResolvedValue(baseOrganization({ gminaId: 'g1', city: 'Kraków' }) as any);

    const res = await callPatch({ city: 'Kraków' });

    expect(res.status).toBe(200);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('rejects reassignment to a nonexistent gmina', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    prisma.gmina.findUnique.mockResolvedValue(null);

    const res = await callPatch({ gminaId: 'missing-gmina' });

    expect(res.status).toBe(400);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('rejects a blank name', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);

    const res = await callPatch({ name: '   ' });

    expect(res.status).toBe(400);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('returns 409 (not a generic 400) when a concurrent rename races past the pre-check and hits the unique constraint', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ name: 'Caritas' }) as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      })
    );

    const res = await callPatch({ name: 'PCK' });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Organizacja o tej nazwie już istnieje w tej gminie.');
  });

  it('rejects malformed JSON with 400 before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    const req = new NextRequest('http://localhost/api/admin/organizations/target-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    });

    const res = await PATCH(req, { params: { id: 'target-1' } });

    expect(res.status).toBe(400);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('returns a clean 400 when the rename/gmina-collision check itself fails', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ name: 'Caritas' }) as any);
    prisma.organization.findFirst.mockRejectedValue(new Error('connection lost'));

    const res = await callPatch({ name: 'PCK' });

    expect(res.status).toBe(400);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('returns a clean 400 when verifying the new gmina (on reassignment) itself fails', async () => {
    // Global admin (gminaId: null) — a gmina-scoped admin is never allowed
    // to reassign an org's gmina at all (see the "gmina-scoped admin actor"
    // describe block below), so that's not what this test is exercising.
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);
    prisma.gmina.findUnique.mockRejectedValue(new Error('connection lost'));

    const res = await callPatch({ gminaId: 'g2' });

    expect(res.status).toBe(400);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('returns a generic 400 (not a false 409/200) when the update transaction fails for an unrelated reason', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    prisma.organization.update.mockRejectedValue(new Error('connection lost'));

    const res = await callPatch({ city: 'Kraków' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Nie udało się zaktualizować organizacji. Sprawdź podane dane.');
  });
});

describe('DELETE /api/admin/organizations/[id]', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callDelete();

    expect(res.status).toBe(403);
    expect(prisma.organization.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent organization', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(null);

    const res = await callDelete('missing');

    expect(res.status).toBe(404);
  });

  it('returns 500 when the initial lookup itself fails', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockRejectedValue(new Error('connection lost'));

    const res = await callDelete();

    expect(res.status).toBe(500);
    expect(prisma.organization.delete).not.toHaveBeenCalled();
  });

  it('lets ADMIN delete an organization with no dependents', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    prisma.organization.delete.mockResolvedValue({} as any);

    const res = await callDelete();

    expect(res.status).toBe(200);
    expect(prisma.organization.delete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
  });

  it('returns 409 when the organization has dependent records (users, resources, or allocations) blocking deletion (P2003)', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    prisma.organization.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: '5.19.1',
      })
    );

    const res = await callDelete();

    expect(res.status).toBe(409);
  });

  it('returns 500 (not a false "has dependents" 409) when delete fails for an unrelated reason', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization() as any);
    prisma.organization.delete.mockRejectedValue(new Error('connection lost'));

    const res = await callDelete();

    expect(res.status).toBe(500);
  });

  describe('gmina-scoped admin actor', () => {
    it('PATCH: can edit an organization in their own gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'g1' });
      prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);
      prisma.organization.update.mockResolvedValue(baseOrganization({ gminaId: 'g1', city: 'Kraków' }) as any);

      const res = await callPatch({ city: 'Kraków' });

      expect(res.status).toBe(200);
    });

    it('PATCH: rejects (403) editing an organization in a DIFFERENT gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'g2' });
      prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);

      const res = await callPatch({ city: 'Kraków' });

      expect(res.status).toBe(403);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('PATCH: rejects (403) reassigning the organization to a different gmina, even their own target', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'g1' });
      prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);

      const res = await callPatch({ gminaId: 'g2' });

      expect(res.status).toBe(403);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('DELETE: rejects (403) deleting an organization in a DIFFERENT gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'g2' });
      prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);

      const res = await callDelete();

      expect(res.status).toBe(403);
      expect(prisma.organization.delete).not.toHaveBeenCalled();
    });
  });
});
