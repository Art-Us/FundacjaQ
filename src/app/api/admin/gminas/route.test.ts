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
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/gminas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/gminas', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(prisma.gmina.findMany).not.toHaveBeenCalled();
  });

  it('returns the gmina list for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findMany.mockResolvedValue([{ id: 'g1', name: 'Warszawa' }] as any);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.gminas).toHaveLength(1);
  });
});

describe('POST /api/admin/gminas', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await POST(makeRequest({ name: 'Warszawa' }));

    expect(res.status).toBe(403);
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('creates a gmina with the given fields', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({ id: 'g1', name: 'Warszawa' } as any);

    const res = await POST(makeRequest({ name: 'Warszawa', powiat: 'warszawski' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.gmina).toEqual({ id: 'g1', name: 'Warszawa' });
    expect(prisma.gmina.create).toHaveBeenCalledWith({ data: { name: 'Warszawa', powiat: 'warszawski' } });
  });

  it('rejects a name that already exists, ignoring case and whitespace, with 409 and no write', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findFirst.mockResolvedValue({ id: 'existing-1', name: 'Warszawa' } as any);

    const res = await POST(makeRequest({ name: '  warszawa  ' }));

    expect(res.status).toBe(409);
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('rejects a missing name before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(prisma.gmina.findFirst).not.toHaveBeenCalled();
  });
});
