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
import { GET } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/login-attempts${query}`);
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/login-attempts', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    expect(prisma.loginAttempt.findMany).not.toHaveBeenCalled();
  });

  it('returns items for an ADMIN session with no filters', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([{ id: 'a1', email: 'x@example.com' }] as any);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
  });

  it('queries with the default take+1, no cursor, and desc ordering when no params are given', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([]);

    await GET(makeRequest());

    expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      })
    );
    const call = prisma.loginAttempt.findMany.mock.calls[0][0] as any;
    expect(call.cursor).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });

  it('applies cursor pagination with skip:1 when a cursor is given', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([]);

    await GET(makeRequest('?cursor=abc123'));

    expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'abc123' },
        skip: 1,
      })
    );
  });

  it('respects an explicit take, requesting take+1 rows', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([]);

    await GET(makeRequest('?take=10'));

    expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 11 }));
  });

  it('sets nextCursor to the last item on the page and trims the extra lookahead row when hasMore', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([
      { id: 'a1' },
      { id: 'a2' },
    ] as any);

    const res = await GET(makeRequest('?take=1'));
    const body = await res.json();

    expect(body.items).toEqual([{ id: 'a1' }]);
    expect(body.nextCursor).toBe('a1');
  });

  it('builds an escaped, case-insensitive contains filter on email', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([]);

    await GET(makeRequest('?email=jan_kowalski%25'));

    const call = prisma.loginAttempt.findMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({
      email: { contains: 'jan\\_kowalski\\%', mode: 'insensitive' },
    });
  });

  it('filters by success=true/false', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([]);

    await GET(makeRequest('?success=false'));

    expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { success: false } }));
  });

  it('filters by a from/to createdAt range', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([]);

    await GET(makeRequest('?from=2026-01-01&to=2026-01-31'));

    const call = prisma.loginAttempt.findMany.mock.calls[0][0] as any;
    expect(call.where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(call.where.createdAt.lte).toEqual(new Date('2026-01-31'));
  });

  it.each(['?success=maybe', '?take=0', '?take=101', '?from=not-a-date'])(
    'rejects an invalid query param (%s) with 400 and no DB call',
    async (query) => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

      const res = await GET(makeRequest(query));

      expect(res.status).toBe(400);
      expect(prisma.loginAttempt.findMany).not.toHaveBeenCalled();
    }
  );

  it('returns 500 when the database call fails', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockRejectedValue(new Error('connection lost'));

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
  });
});
