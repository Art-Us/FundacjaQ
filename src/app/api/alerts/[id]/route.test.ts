import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

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
import { PATCH, DELETE } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function baseAlert(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'alert-1',
    title: 'Powódź w centrum',
    description: 'Woda podnosi się szybko.',
    kind: 'ALERT',
    severity: 'HIGH',
    status: 'ACTIVE',
    category: 'HYDROLOGICAL',
    location: null,
    latitude: 52.2297,
    longitude: 21.0122,
    authorId: 'author-1',
    organizationId: null,
    gminaId: 'gmina-1',
    expiresAt: null,
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/alerts/alert-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function callPatch(body: unknown, id = 'alert-1') {
  return PATCH(patchRequest(body), { params: { id } });
}

function callDelete(id = 'alert-1') {
  return DELETE(new NextRequest('http://localhost/api/alerts/alert-1', { method: 'DELETE' }), { params: { id } });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('PATCH /api/alerts/[id]', () => {
  it('returns 403 with no DB write when there is no authorized session', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await callPatch({ title: 'Zaktualizowany tytuł' });

    expect(res.status).toBe(403);
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await callPatch({ title: 'x' }, 'missing');

    expect(res.status).toBe(404);
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  // Mirrors scopedGminaWhere's fail-closed contract: a gmina-scoped role may
  // only manage resources within its own gmina.
  it("rejects a COORDINATOR editing another gmina's alert with 403 and no write", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: 'gmina-1' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert({ gminaId: 'gmina-OTHER' }) as any);

    const res = await callPatch({ title: 'Zaktualizowany tytuł' });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Nie masz uprawnień do edycji tego alertu.');
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  // Regression / fail-closed edge case: a COORDINATOR with no gmina of their
  // own must not be able to edit any alert, since alert.gminaId (always a
  // real, non-null gmina id) can never equal null.
  it('rejects a COORDINATOR with no gmina of their own from editing any alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert({ gminaId: 'gmina-1' }) as any);

    const res = await callPatch({ title: 'Zaktualizowany tytuł' });

    expect(res.status).toBe(403);
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('lets a COORDINATOR edit an alert in their own gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: 'gmina-1' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert({ gminaId: 'gmina-1' }) as any);
    prisma.alert.update.mockResolvedValue({} as any);

    const res = await callPatch({ title: 'Zaktualizowany tytuł' });

    expect(res.status).toBe(200);
    expect(prisma.alert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: { title: 'Zaktualizowany tytuł' },
    });
  });

  it("lets ADMIN edit any gmina's alert", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert({ gminaId: 'gmina-OTHER' }) as any);
    prisma.alert.update.mockResolvedValue({} as any);

    const res = await callPatch({ status: 'RESOLVED' });

    expect(res.status).toBe(200);
    expect(prisma.alert.update).toHaveBeenCalledWith({ where: { id: 'alert-1' }, data: { status: 'RESOLVED' } });
  });

  it('rejects malformed JSON with 400', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert() as any);

    const res = await PATCH(
      new NextRequest('http://localhost/api/alerts/alert-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{not valid json',
      }),
      { params: { id: 'alert-1' } }
    );

    expect(res.status).toBe(400);
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('rejects an empty update body with 400 ("no changes to save")', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert() as any);

    const res = await callPatch({});
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Brak zmian do zapisania.');
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('rejects a category that does not match the alert\'s existing kind', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    // alert.kind is ALERT; FESTIVAL is an EVENT-only category.
    prisma.alert.findUnique.mockResolvedValue(baseAlert({ kind: 'ALERT' }) as any);

    const res = await callPatch({ category: 'FESTIVAL' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Wybrana kategoria nie należy do tego rodzaju wpisu.');
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('accepts a category matching the existing EVENT kind', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert({ kind: 'EVENT', category: 'FESTIVAL' }) as any);
    prisma.alert.update.mockResolvedValue({} as any);

    const res = await callPatch({ category: 'CONCERT' });

    expect(res.status).toBe(200);
  });

  it('rejects an out-of-range latitude with 400', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert() as any);

    const res = await callPatch({ latitude: 200 });

    expect(res.status).toBe(400);
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('propagates a thrown Prisma error from update (no try/catch in this route)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert() as any);
    prisma.alert.update.mockRejectedValue(new Error('connection lost'));

    await expect(callPatch({ title: 'x' })).rejects.toThrow('connection lost');
  });
});

describe('DELETE /api/alerts/[id]', () => {
  it('returns 403 with no DB call when there is no authorized session', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await callDelete();

    expect(res.status).toBe(403);
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
    expect(prisma.alert.delete).not.toHaveBeenCalled();
  });

  // The hard-delete gate is ADMIN-only, independent of gmina ownership — a
  // COORDINATOR must be rejected even for an alert in their own gmina.
  it("rejects a COORDINATOR deleting an alert in their own gmina (403, no lookup/delete)", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: 'gmina-1' });

    const res = await callDelete();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Tylko administrator może trwale usunąć alert.');
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
    expect(prisma.alert.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent alert (ADMIN)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await callDelete('missing');

    expect(res.status).toBe(404);
    expect(prisma.alert.delete).not.toHaveBeenCalled();
  });

  it('lets ADMIN permanently delete an alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert() as any);
    prisma.alert.delete.mockResolvedValue({} as any);

    const res = await callDelete();

    expect(res.status).toBe(200);
    expect(prisma.alert.delete).toHaveBeenCalledWith({ where: { id: 'alert-1' } });
  });

  it('propagates a thrown Prisma error from delete (no try/catch in this route)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert() as any);
    prisma.alert.delete.mockRejectedValue(new Error('connection lost'));

    await expect(callDelete()).rejects.toThrow('connection lost');
  });
});
