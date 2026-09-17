import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdmin: vi.fn() };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { installTransactionMock } from '@/lib/__mocks__/prisma';
import { requireAdmin } from '@/lib/authz';
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
  // at module load — PATCH runs the users-count re-check + organization.update
  // through prisma.$transaction(async (tx) => ...), so it must be
  // reinstalled here (see the doc comment on installTransactionMock).
  installTransactionMock(prisma);
  vi.mocked(requireAdmin).mockReset();
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
  // gminaId set to that organization's CURRENT gmina — reassigning it out
  // from under them would silently strand those users, so it's blocked
  // whenever the organization still has any dependents, mirroring how a
  // dependent-having record already blocks deletion elsewhere.
  it('rejects reassigning gminaId when the organization still has users assigned', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g2' } as any);
    prisma.user.count.mockResolvedValue(1);

    const res = await callPatch({ gminaId: 'g2' });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('powiązani użytkownicy');
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('allows reassigning gminaId when the organization has no users assigned', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g2' } as any);
    prisma.user.count.mockResolvedValue(0);
    prisma.organization.update.mockResolvedValue({} as any);

    const res = await callPatch({ gminaId: 'g2' });

    expect(res.status).toBe(200);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gmina: { connect: { id: 'g2' } } }) })
    );
  });

  // Regression coverage for the org/gmina TOCTOU race: usersCount is
  // re-checked immediately before the write, inside the transaction, so a
  // concurrent POST/PATCH /api/admin/users assigning a user to this
  // organization in between the precheck and the write is caught rather
  // than silently stranding that user in a now-wrong gmina.
  it('aborts with 409 when a user gets assigned to the organization between the precheck and the write', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findUnique.mockResolvedValue(baseOrganization({ gminaId: 'g1' }) as any);
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g2' } as any);
    prisma.user.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const res = await callPatch({ gminaId: 'g2' });

    expect(res.status).toBe(409);
    expect(prisma.organization.update).not.toHaveBeenCalled();
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
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: 'g1' });
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

  it('returns 409 when the organization has users assigned, blocking deletion (P2003)', async () => {
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
});
