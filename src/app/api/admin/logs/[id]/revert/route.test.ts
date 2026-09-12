import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock('@/lib/auditLog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auditLog')>('@/lib/auditLog');
  return { ...actual, revertAuditLog: vi.fn() };
});

import { requireAdmin } from '@/lib/authz';
import { revertAuditLog } from '@/lib/auditLog';
import { POST } from './route';

function callPost(id = 'log-1') {
  return POST(new Request('http://localhost/api/admin/logs/log-1/revert', { method: 'POST' }), { params: { id } });
}

beforeEach(() => {
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
    expect(revertAuditLog).toHaveBeenCalledWith('log-42', expect.objectContaining({ id: 'admin-1' }), expect.anything());
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
});
