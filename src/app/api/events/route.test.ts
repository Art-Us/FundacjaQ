import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/authz', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/eventStream', () => ({ adminEventStreamResponse: vi.fn(() => new Response('stream')) }));

import { requireUser } from '@/lib/authz';
import { adminEventStreamResponse } from '@/lib/eventStream';
import type { AdminEvent } from '@/lib/adminEvents';
import { GET } from './route';

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(adminEventStreamResponse).mockClear();
});

describe('GET /api/events', () => {
  it('returns 403 without opening a stream when there is no session', async () => {
    vi.mocked(requireUser).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(adminEventStreamResponse).not.toHaveBeenCalled();
  });

  it('opens a stream for a VOLUNTEER, forwarding only alert events', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'v1', role: 'VOLUNTEER', gminaId: 'g1' });

    const res = await GET();

    expect(res.status).toBe(200);
    const filter = vi.mocked(adminEventStreamResponse).mock.calls[0][0] as (e: AdminEvent) => boolean;
    expect(filter({ scope: 'alerts', alertId: 'a1' })).toBe(true);
    expect(filter({ scope: 'users', action: 'USER_CREATE' })).toBe(false);
    expect(filter({ scope: 'logs' })).toBe(false);
  });
});
