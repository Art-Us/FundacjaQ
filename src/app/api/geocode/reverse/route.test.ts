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
  return new NextRequest(`http://localhost/api/geocode/reverse${query}`);
}

function mockSession(role: string | null, id = 'session-user') {
  vi.mocked(getServerSession).mockResolvedValue(role ? ({ user: { id, role } } as any) : null);
}

beforeEach(() => {
  vi.mocked(consumeLimit).mockReset().mockResolvedValue(true);
  vi.mocked(fetchNominatim).mockReset();
  vi.mocked(getServerSession).mockReset();
});

describe('GET /api/geocode/reverse', () => {
  it('returns 403 with no rate-limit check or upstream call when there is no session', async () => {
    mockSession(null);

    const res = await GET(makeRequest('?lat=50&lon=21'));

    expect(res.status).toBe(403);
    expect(consumeLimit).not.toHaveBeenCalled();
    expect(fetchNominatim).not.toHaveBeenCalled();
  });

  it('returns 403 for a VOLUNTEER session', async () => {
    mockSession('VOLUNTEER');

    const res = await GET(makeRequest('?lat=50&lon=21'));

    expect(res.status).toBe(403);
  });

  it('allows an ADMIN session', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim).mockResolvedValue({ address: { road: 'Rzeczna', town: 'Nowa Dęba' } } as any);

    const res = await GET(makeRequest('?lat=50.42&lon=21.75'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.location).toBe('Rzeczna');
  });

  it('allows a COORDINATOR session', async () => {
    mockSession('COORDINATOR');
    vi.mocked(fetchNominatim).mockResolvedValue({ address: {} } as any);

    const res = await GET(makeRequest('?lat=50&lon=21'));

    expect(res.status).toBe(200);
  });

  it('returns 429 when the rate limit is exceeded, without calling the upstream lookup', async () => {
    mockSession('ADMIN');
    vi.mocked(consumeLimit).mockResolvedValue(false);

    const res = await GET(makeRequest('?lat=50&lon=21'));

    expect(res.status).toBe(429);
    expect(fetchNominatim).not.toHaveBeenCalled();
  });

  it.each(['?lat=91&lon=21', '?lat=-91&lon=21', '?lat=50&lon=181', '?lat=50&lon=-181', '?lat=abc&lon=21', '?lat=50&lon=abc'])(
    'rejects out-of-range/malformed coordinates (%s) with 400 and no upstream call',
    async (query) => {
      mockSession('ADMIN');

      const res = await GET(makeRequest(query));

      expect(res.status).toBe(400);
      expect(fetchNominatim).not.toHaveBeenCalled();
    }
  );

  // NOTE: documents actual (surprising) behavior rather than asserting it as
  // correct. `Number(null)` is 0, so a request missing `lat` or `lon`
  // entirely does NOT fail the `Number.isFinite` + range check the route
  // uses for validation — it silently treats the missing coordinate as 0
  // (the equator/prime meridian) instead of being rejected as malformed
  // input. Flagged separately as a suspected validation gap.
  it('treats a missing lat as 0 rather than rejecting the request (suspected validation gap)', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim).mockResolvedValue({ address: {} } as any);

    const res = await GET(makeRequest('?lon=21'));

    expect(res.status).toBe(200);
    expect(fetchNominatim).toHaveBeenCalled();
  });

  it('accepts boundary coordinates (90/-180)', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim).mockResolvedValue({ address: {} } as any);

    const res = await GET(makeRequest('?lat=90&lon=-180'));

    expect(res.status).toBe(200);
  });

  it('returns 502 when the upstream Nominatim call throws', async () => {
    mockSession('ADMIN');
    vi.mocked(fetchNominatim).mockRejectedValue(new Error('Nominatim responded with 503'));

    const res = await GET(makeRequest('?lat=50&lon=21'));

    expect(res.status).toBe(502);
  });

  it('returns 504 with a distinct message when the upstream lookup times out', async () => {
    mockSession('ADMIN');
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    vi.mocked(fetchNominatim).mockRejectedValue(timeoutError);

    const res = await GET(makeRequest('?lat=50&lon=21'));
    const body = await res.json();

    expect(res.status).toBe(504);
    expect(body.error).toContain('trwa zbyt długo');
  });
});
