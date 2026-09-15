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
import { requireAdmin } from '@/lib/authz';
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/organizations', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
  });

  it('returns the organization list for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.organization.findMany.mockResolvedValue([{ id: 'o1', name: 'Caritas' }] as any);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.organizations).toHaveLength(1);
  });
});

describe('POST /api/admin/organizations', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'g1' }));

    expect(res.status).toBe(403);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('creates an organization with the given fields', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({ id: 'o1', name: 'Caritas', gminaId: 'g1' } as any);

    const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'g1', city: 'Kraków' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.organization).toEqual({ id: 'o1', name: 'Caritas', gminaId: 'g1' });
    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: { name: 'Caritas', gmina: { connect: { id: 'g1' } }, city: 'Kraków', contactEmail: null },
    });
  });

  it('rejects a name that already exists in the SAME gmina, ignoring case, with 409 and no write', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockResolvedValue({ id: 'existing-1', name: 'Caritas', gminaId: 'g1' } as any);

    const res = await POST(makeRequest({ name: '  caritas  ', gminaId: 'g1' }));

    expect(res.status).toBe(409);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('rejects a missing name before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ gminaId: 'g1' }));

    expect(res.status).toBe(400);
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a missing gminaId before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ name: 'Caritas' }));

    expect(res.status).toBe(400);
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an invalid contact email', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ name: 'Caritas', gminaId: 'g1', contactEmail: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });
});
