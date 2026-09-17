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
import { PATCH, DELETE } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function baseGmina(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'target-1',
    name: 'Warszawa',
    powiat: null,
    voivodeship: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/gminas/target-1', {
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
  vi.mocked(requireAdmin).mockReset();
});

describe('PATCH /api/admin/gminas/[id]', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callPatch({ name: 'New Name' });

    expect(res.status).toBe(403);
    expect(prisma.gmina.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent gmina', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(null);

    const res = await callPatch({ name: 'New Name' }, 'missing');

    expect(res.status).toBe(404);
  });

  it('updates fields for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina() as any);
    prisma.gmina.update.mockResolvedValue({} as any);

    const res = await callPatch({ powiat: 'warszawski', voivodeship: 'mazowieckie' });

    expect(res.status).toBe(200);
    expect(prisma.gmina.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { powiat: 'warszawski', voivodeship: 'mazowieckie' },
    });
  });

  it('allows renaming to a name that only differs from itself by case/whitespace', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina({ name: 'Warszawa' }) as any);
    prisma.gmina.update.mockResolvedValue({} as any);

    const res = await callPatch({ name: '  warszawa  ' });

    expect(res.status).toBe(200);
    expect(prisma.gmina.findFirst).not.toHaveBeenCalled();
    expect(prisma.gmina.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { name: 'warszawa' },
    });
  });

  it('rejects renaming to a name already used by another gmina (case/whitespace-insensitive)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina({ name: 'Warszawa' }) as any);
    prisma.gmina.findFirst.mockResolvedValue({ id: 'other-gmina', name: 'Kraków' } as any);

    const res = await callPatch({ name: 'Kraków' });

    expect(res.status).toBe(409);
    expect(prisma.gmina.update).not.toHaveBeenCalled();
  });

  it('clears powiat/voivodeship/latitude/longitude when explicitly set to null', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(
      baseGmina({ powiat: 'warszawski', voivodeship: 'mazowieckie', latitude: 52.2, longitude: 21.0 }) as any
    );
    prisma.gmina.update.mockResolvedValue({} as any);

    const res = await callPatch({ powiat: null, voivodeship: null, latitude: null, longitude: null });

    expect(res.status).toBe(200);
    expect(prisma.gmina.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { powiat: null, voivodeship: null, latitude: null, longitude: null },
    });
  });

  it('updates latitude/longitude within range', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina() as any);
    prisma.gmina.update.mockResolvedValue({} as any);

    const res = await callPatch({ latitude: 52.2297, longitude: 21.0122 });

    expect(res.status).toBe(200);
    expect(prisma.gmina.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { latitude: 52.2297, longitude: 21.0122 },
    });
  });

  it.each([
    ['latitude', 91],
    ['latitude', -91],
    ['longitude', 181],
    ['longitude', -181],
  ])('rejects an out-of-range %s (%d) with 400 and no DB write', async (field, value) => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina() as any);

    const res = await callPatch({ [field]: value });

    expect(res.status).toBe(400);
    expect(prisma.gmina.update).not.toHaveBeenCalled();
  });

  it('performs a no-op update when no fields are given', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina() as any);
    prisma.gmina.update.mockResolvedValue({} as any);

    const res = await callPatch({});

    expect(res.status).toBe(200);
    expect(prisma.gmina.update).toHaveBeenCalledWith({ where: { id: 'target-1' }, data: {} });
  });

  it('rejects a blank name', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina() as any);

    const res = await callPatch({ name: '   ' });

    expect(res.status).toBe(400);
    expect(prisma.gmina.update).not.toHaveBeenCalled();
  });

  it('returns a clean 400 (not an unhandled crash) when the duplicate-check read itself fails', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina({ name: 'Warszawa' }) as any);
    prisma.gmina.findFirst.mockRejectedValue(new Error('connection lost'));

    const res = await callPatch({ name: 'Kraków' });

    expect(res.status).toBe(400);
    expect(prisma.gmina.update).not.toHaveBeenCalled();
  });

  it('returns 409 (not a generic 400) when a concurrent rename races past the pre-check and hits the unique constraint', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina({ name: 'Warszawa' }) as any);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      })
    );

    const res = await callPatch({ name: 'Kraków' });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Gmina o tej nazwie już istnieje.');
  });
});

describe('DELETE /api/admin/gminas/[id]', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callDelete();

    expect(res.status).toBe(403);
    expect(prisma.gmina.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent gmina', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(null);

    const res = await callDelete('missing');

    expect(res.status).toBe(404);
  });

  it('lets ADMIN delete a gmina with no dependents', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina() as any);
    prisma.gmina.delete.mockResolvedValue({} as any);

    const res = await callDelete();

    expect(res.status).toBe(200);
    expect(prisma.gmina.delete).toHaveBeenCalledWith({ where: { id: 'target-1' } });
  });

  it('returns 409 when the gmina has related records blocking deletion (P2003)', async () => {
    const { Prisma } = await import('@prisma/client');
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(baseGmina() as any);
    prisma.gmina.delete.mockRejectedValue(
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
    prisma.gmina.findUnique.mockResolvedValue(baseGmina() as any);
    prisma.gmina.delete.mockRejectedValue(new Error('connection lost'));

    const res = await callDelete();

    expect(res.status).toBe(500);
  });
});
