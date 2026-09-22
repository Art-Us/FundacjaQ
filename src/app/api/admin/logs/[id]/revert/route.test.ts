import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock('@/lib/auditLog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auditLog')>('@/lib/auditLog');
  return { ...actual, revertAuditLog: vi.fn() };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { revertAuditLog } from '@/lib/auditLog';
import { POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function callPost(id = 'log-1') {
  return POST(new Request('http://localhost/api/admin/logs/log-1/revert', { method: 'POST' }), { params: { id } });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(revertAuditLog).mockReset();
});

describe('POST /api/admin/logs/[id]/revert', () => {
  it('rejects with 403 and never calls revertAuditLog for a non-ADMIN caller', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await callPost();

    expect(res.status).toBe(403);
    expect(revertAuditLog).not.toHaveBeenCalled();
  });

  it('delegates to revertAuditLog with the log id and the ADMIN actor', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    vi.mocked(revertAuditLog).mockResolvedValue({ ok: true, revertedLogIds: ['log-42'] });

    const res = await callPost('log-42');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBeTruthy();
    // A global admin passes no restrictToGminaId (4th arg) — unrestricted.
    expect(revertAuditLog).toHaveBeenCalledWith(
      'log-42',
      expect.objectContaining({ id: 'admin-1' }),
      expect.anything(),
      undefined
    );
  });

  it('reports how many entries were reverted when the request cascaded through more than one', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    vi.mocked(revertAuditLog).mockResolvedValue({ ok: true, revertedLogIds: ['log-3', 'log-2', 'log-1'] });

    const res = await callPost('log-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain('3');
    expect(body.revertedLogIds).toEqual(['log-3', 'log-2', 'log-1']);
  });

  it('maps a failed revert result straight to its status/error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    vi.mocked(revertAuditLog).mockResolvedValue({ ok: false, status: 409, error: 'Już cofnięte.' });

    const res = await callPost();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Już cofnięte.');
  });

  describe('gmina-scoped admin actor', () => {
    it('can revert an entry belonging to their own gmina', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'gadmin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.auditLog.findUnique.mockResolvedValue({ gminaId: 'gmina-1' } as any);
      vi.mocked(revertAuditLog).mockResolvedValue({ ok: true, revertedLogIds: ['log-1'] });

      const res = await callPost();

      expect(res.status).toBe(200);
      // Passes their own gmina as restrictToGminaId (4th arg) so
      // revertAuditLog also enforces it across the whole cascade chain, not
      // just the requested entry.
      expect(revertAuditLog).toHaveBeenCalledWith(
        'log-1',
        expect.objectContaining({ id: 'gadmin-1' }),
        expect.anything(),
        'gmina-1'
      );
    });

    it('rejects (403) reverting an entry belonging to a DIFFERENT gmina, never calling revertAuditLog', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'gadmin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.auditLog.findUnique.mockResolvedValue({ gminaId: 'gmina-2' } as any);

      const res = await callPost();

      expect(res.status).toBe(403);
      expect(revertAuditLog).not.toHaveBeenCalled();
    });

    it('returns 404 for a nonexistent log entry without calling revertAuditLog', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ id: 'gadmin-1', role: 'ADMIN', gminaId: 'gmina-1' });
      prisma.auditLog.findUnique.mockResolvedValue(null);

      const res = await callPost();

      expect(res.status).toBe(404);
      expect(revertAuditLog).not.toHaveBeenCalled();
    });
  });
});
