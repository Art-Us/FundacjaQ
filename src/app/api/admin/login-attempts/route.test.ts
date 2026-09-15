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
import { GET } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function callGet(query = '') {
  return GET(new NextRequest(`http://localhost/api/admin/login-attempts${query}`));
}

function attemptRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'attempt-1',
    email: 'user@example.com',
    userId: 'u1',
    success: true,
    ipAddress: '1.2.3.4',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/login-attempts', () => {
  it('rejects with 403 and no DB call for a non-ADMIN caller', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(403);
    expect(prisma.loginAttempt.findMany).not.toHaveBeenCalled();
  });

  it('returns the most recent attempts', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([attemptRow()] as any);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
  });

  it('applies the email and success filters to the query', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([]);

    await callGet('?email=user%40example.com&success=false');

    expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { contains: 'user@example.com', mode: 'insensitive' },
          success: false,
        }),
      })
    );
  });

  // Regression coverage: Postgres's (I)LIKE treats `%` and `_` as wildcards
  // regardless of parameter binding — an unescaped search for an email
  // containing a literal underscore (an ordinary character in a local-part)
  // would otherwise also match unrelated emails with any other character in
  // that position.
  it('escapes LIKE wildcard characters in the email filter so they match literally', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.loginAttempt.findMany.mockResolvedValue([]);

    await callGet('?email=jan_kowalski%25');

    expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { contains: 'jan\\_kowalski\\%', mode: 'insensitive' },
        }),
      })
    );
  });

  it('paginates via cursor, returning nextCursor only when there is another page', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    const rows = [attemptRow({ id: 'attempt-2' }), attemptRow({ id: 'attempt-1' })];
    prisma.loginAttempt.findMany.mockResolvedValue(rows as any);

    const res = await callGet('?take=1');
    const body = await res.json();

    expect(prisma.loginAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBe('attempt-2');
  });

  it('rejects an invalid success filter value before querying the DB', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await callGet('?success=maybe');

    expect(res.status).toBe(400);
    expect(prisma.loginAttempt.findMany).not.toHaveBeenCalled();
  });
});
