import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/authz', () => ({ requireAdminOrCoordinator: vi.fn() }));
vi.mock('@/lib/eventStream', () => ({ adminEventStreamResponse: vi.fn(() => new Response('stream')) }));

import { requireAdminOrCoordinator } from '@/lib/authz';
import { adminEventStreamResponse } from '@/lib/eventStream';
import type { AdminEvent } from '@/lib/adminEvents';
import { GET } from './route';

beforeEach(() => {
  vi.mocked(requireAdminOrCoordinator).mockReset();
  vi.mocked(adminEventStreamResponse).mockClear();
});

describe('GET /api/admin/events', () => {
  it('returns 403 without opening a stream for a non-admin/coordinator', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(adminEventStreamResponse).not.toHaveBeenCalled();
  });

  it('forwards admin-panel events but leaves alert events to /api/events', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1' });

    await GET();

    const filter = vi.mocked(adminEventStreamResponse).mock.calls[0][0] as (e: AdminEvent) => boolean;
    expect(filter({ scope: 'users', action: 'USER_CREATE' })).toBe(true);
    expect(filter({ scope: 'invites' })).toBe(true);
    expect(filter({ scope: 'alerts', alertId: 'a1' })).toBe(false);
  });
});
