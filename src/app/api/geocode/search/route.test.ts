import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rateLimit', () => ({
  consumeLimit: vi.fn(),
  geocodeLimiter: {},
}));
vi.mock('@/lib/geocode', async () => {
  const actual = await vi.importActual<typeof import('@/lib/geocode')>('@/lib/geocode');
  return {
    ...actual,
    fetchNominatim: vi.fn(),
  };
});
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { consumeLimit } from '@/lib/rateLimit';
import { fetchNominatim } from '@/lib/geocode';
import { getServerSession } from 'next-auth';
import { GET } from './route';

function makeRequest(query = '') {
  return new NextRequest(`http://localhost/api/geocode/search${query}`);
}

function mockSession(role: string | null, id = 'session-user') {
  vi.mocked(getServerSession).mockResolvedValue(role ? ({ user: { id, role } } as any) : null);
}

beforeEach(() => {
  vi.mocked(consumeLimit).mockReset().mockResolvedValue(true);
  vi.mocked(fetchNominatim).mockReset();
  vi.mocked(getServerSession).mockReset();
});

describe('GET /api/geocode/search', () => {
  it('returns 403 with no rate-limit check or upstream call when there is no session', async () => {
    mockSession(null);

    const res = await GET(makeRequest('?q=Rzeczna'));

    expect(res.status).toBe(403);
    expect(consumeLimit).not.toHaveBeenCalled();
    expect(fetchNominatim).not.toHaveBeenCalled();
  });

  it('returns 403 for a VOLUNTEER session', async () => {
    mockSession('VOLUNTEER');

    const res = await GET(makeRequest('?q=Rzeczna'));

    expect(res.status).toBe(403);
  });

  it('returns 429 when the rate limit is exceeded, without calling the upstream lookup', async () => {
    mockSession('ADMIN');
    vi.mocked(consumeLimit).mockResolvedValue(false);

    const res = await GET(makeRequest('?q=Rzeczna'));

    expect(res.status).toBe(429);
    expect(fetchNominatim).not.toHaveBeenCalled();
  });

  it.each(['?q=', '?q=ab', '?', '?q=%20%20'])(
    'rejects a too-short/empty query (%s) with 400 and no upstream call',
    async (query) => {
      mockSession('ADMIN');

      const res = await GET(makeRequest(query));

      expect(res.status).toBe(400);
      expect(fetchNominatim).not.toHaveBeenCalled();
    }
  );

  it('returns the first gmina-scoped hit without falling through to later steps', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim).mockResolvedValueOnce([
      { lat: '50.42', lon: '21.75', address: { road: 'Rzeczna', town: 'Nowa Dęba' } },
    ] as any);

    const res = await GET(makeRequest('?q=Rzeczna'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fetchNominatim).toHaveBeenCalledTimes(1);
    expect(body).toEqual(
      expect.objectContaining({ found: true, lat: 50.42, lon: 21.75, location: 'Rzeczna' })
    );
  });

  it('falls through to the free-form step when the scoped step finds nothing', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ lat: '50.1', lon: '21.1', address: {} }] as any);

    const res = await GET(makeRequest('?q=Rzeczna'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fetchNominatim).toHaveBeenCalledTimes(2);
    expect(body.found).toBe(true);
  });

  it('returns found:false when all three steps come up empty', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim).mockResolvedValue([] as any);

    const res = await GET(makeRequest('?q=Nieistniejąca'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fetchNominatim).toHaveBeenCalledTimes(3);
    expect(body).toEqual({ found: false });
  });

  it('returns found:false when the upstream result has no usable lat/lon', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim).mockResolvedValue([{ lat: 'not-a-number', lon: '21.1', address: {} }] as any);

    const res = await GET(makeRequest('?q=Rzeczna'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ found: false });
  });

  it('returns 502 when the upstream Nominatim call throws', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim).mockRejectedValue(new Error('Nominatim responded with 503'));

    const res = await GET(makeRequest('?q=Rzeczna'));

    expect(res.status).toBe(502);
  });
});
