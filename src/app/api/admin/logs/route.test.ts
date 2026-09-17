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
  return GET(new NextRequest(`http://localhost/api/admin/logs${query}`));
}

function logRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'log-1',
    actorId: 'admin-1',
    actorEmail: 'admin@example.com',
    actorName: 'Admin',
    actorRole: 'ADMIN',
    action: 'USER_UPDATE',
    entityType: 'USER',
    entityId: 'user-1',
    gminaId: 'gmina-1',
    before: null,
    after: null,
    ipAddress: null,
    userAgent: null,
    isRevert: false,
    revertOfId: null,
    revertedById: null,
    revertedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
});

describe('GET /api/admin/logs', () => {
  it('rejects with 403 and no DB call for a non-ADMIN caller', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(403);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('returns 500 when the database read fails', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockRejectedValue(new Error('connection lost'));

    const res = await callGet();

    expect(res.status).toBe(500);
  });

  it('returns the most recent logs with a canRevert flag by default', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([logRow()] as any);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].canRevert).toBe(true);
    expect(body.nextCursor).toBeNull();
  });

  it('marks an already-reverted entry as not revertible', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([logRow({ revertedAt: new Date() })] as any);

    const res = await callGet();
    const body = await res.json();

    expect(body.logs[0].canRevert).toBe(false);
  });

  it('applies entityType/actorId/gminaId filters to the query', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?entityType=USER&actorId=admin-2&gminaId=gmina-9');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: 'USER',
          actorId: 'admin-2',
          gminaId: 'gmina-9',
        }),
      })
    );
  });

  // actionKind is coarse (create/update/delete/invite) — which entity it's
  // about is the separate entityType filter, so one kind can span several of
  // the exact per-entity action codes.
  it('expands actionKind into an "in" filter over its underlying action codes', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?actionKind=UPDATE');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: { in: ['USER_UPDATE', 'GMINA_UPDATE', 'USER_ACTIVATE', 'USER_DEACTIVATE', 'ORGANIZATION_UPDATE'] },
        }),
      })
    );
  });

  // Regression coverage: the client-side search used to only filter logs
  // already loaded in the browser, silently missing anything not yet paged
  // in. Matching server-side against actorEmail/actorName/entityId covers
  // the whole (filtered) log instead.
  it('applies the free-text q filter as a case-insensitive OR across actor/entity fields', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?q=jan.kowalski%40example.com');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { actorEmail: { contains: 'jan.kowalski@example.com', mode: 'insensitive' } },
            { actorName: { contains: 'jan.kowalski@example.com', mode: 'insensitive' } },
            { entityId: { contains: 'jan.kowalski@example.com', mode: 'insensitive' } },
          ],
        }),
      })
    );
  });

  it('escapes LIKE wildcard characters in q so they match literally', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?q=jan_kowalski');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ actorEmail: { contains: 'jan\\_kowalski', mode: 'insensitive' } }]),
        }),
      })
    );
  });

  it('ignores a blank q instead of matching every row', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?q=%20%20');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ OR: expect.anything() }),
      })
    );
  });

  it('rejects an invalid enum filter value before querying the DB', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await callGet('?actionKind=NOT_A_REAL_KIND');

    expect(res.status).toBe(400);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  // Regression coverage: a cascading revert writes several AuditLog rows in
  // one transaction, and Postgres's CURRENT_TIMESTAMP (what `createdAt`
  // resolves to) is frozen for the whole transaction — so those rows can
  // share an identical createdAt. Paginating on that alone is not a
  // deterministic order, so `seq` (unique, strictly increasing) must be the
  // actual sort key, not just a display timestamp.
  it('orders by the unique seq column, not createdAt', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet();

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { seq: 'desc' } }));
  });

  it('paginates via cursor, returning nextCursor only when there is another page', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    const rows = [logRow({ id: 'log-2' }), logRow({ id: 'log-1' })];
    prisma.auditLog.findMany.mockResolvedValue(rows as any);

    const res = await callGet('?take=1');
    const body = await res.json();

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(body.logs).toHaveLength(1);
    expect(body.nextCursor).toBe('log-2');
  });

  it('applies the entityId filter to the query', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?entityId=some-id');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entityId: 'some-id' }),
      })
    );
  });

  it('applies only a lower bound (gte) when only `from` is given', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?from=2026-01-01');

    const call = prisma.auditLog.findMany.mock.calls[0][0] as any;
    expect(call.where.createdAt).toEqual({ gte: new Date('2026-01-01') });
  });

  it('applies only an upper bound (lte) when only `to` is given', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?to=2026-01-31');

    const call = prisma.auditLog.findMany.mock.calls[0][0] as any;
    expect(call.where.createdAt).toEqual({ lte: new Date('2026-01-31') });
  });

  it('applies both bounds when `from` and `to` are given together', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?from=2026-01-01&to=2026-01-31');

    const call = prisma.auditLog.findMany.mock.calls[0][0] as any;
    expect(call.where.createdAt).toEqual({ gte: new Date('2026-01-01'), lte: new Date('2026-01-31') });
  });

  it('forwards the cursor param as a Prisma cursor + skip:1', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await callGet('?cursor=some-log-id');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'some-log-id' },
        skip: 1,
      })
    );
  });

  it('trims the lookahead row and sets nextCursor when more rows exist than requested (default take)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    // DEFAULT_TAKE is 50, so the route asks for 51; return exactly that many
    // to exercise the "there is another page" branch at the default take.
    const rows = Array.from({ length: 51 }, (_, i) => logRow({ id: `log-${i}` }));
    prisma.auditLog.findMany.mockResolvedValue(rows as any);

    const res = await callGet();
    const body = await res.json();

    expect(body.logs).toHaveLength(50);
    expect(body.nextCursor).toBe('log-49');
  });

  it('does not trim and returns a null nextCursor when there are no more rows than requested', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    const rows = [logRow({ id: 'log-1' }), logRow({ id: 'log-2' })];
    prisma.auditLog.findMany.mockResolvedValue(rows as any);

    const res = await callGet('?take=2');
    const body = await res.json();

    expect(body.logs).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });
});
