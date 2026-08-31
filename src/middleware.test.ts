import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(),
}));

import { getToken } from 'next-auth/jwt';
import { middleware } from './middleware';

function makeReq(pathname: string) {
  return new NextRequest(new URL(pathname, 'http://localhost:3000'));
}

beforeEach(() => {
  vi.mocked(getToken).mockReset();
});

describe('middleware', () => {
  describe('auth-only pages (login, invite, forgot-password, reset-password)', () => {
    it.each(['/login', '/invite/abc123', '/forgot-password', '/reset-password/abc123'])(
      'redirects an already-signed-in user away from %s',
      async (path) => {
        vi.mocked(getToken).mockResolvedValue({ invalid: false, role: 'VOLUNTEER' } as any);

        const res = await middleware(makeReq(path));

        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toBe('http://localhost:3000/');
      }
    );

    it('lets a signed-out visitor (no token) reach /login', async () => {
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await middleware(makeReq('/login'));

      expect(res.status).toBe(200);
    });

    it('lets a visitor with a stale/invalidated token reach /login rather than looping', async () => {
      vi.mocked(getToken).mockResolvedValue({ invalid: true, role: 'VOLUNTEER' } as any);

      const res = await middleware(makeReq('/login'));

      expect(res.status).toBe(200);
    });
  });

  it('never bounces away from /account-blocked, even with a live-looking token', async () => {
    vi.mocked(getToken).mockResolvedValue({ invalid: false, role: 'VOLUNTEER' } as any);

    const res = await middleware(makeReq('/account-blocked'));

    expect(res.status).toBe(200);
    expect(getToken).not.toHaveBeenCalled();
  });

  describe('protected pages', () => {
    it('redirects to /login (with callbackUrl) when there is no token', async () => {
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await middleware(makeReq('/'));

      expect(res.status).toBe(307);
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('callbackUrl')).toBe('/');
    });

    it('redirects to /login when the token is invalid', async () => {
      vi.mocked(getToken).mockResolvedValue({ invalid: true } as any);

      const res = await middleware(makeReq('/'));

      expect(res.status).toBe(307);
    });

    it('allows a valid token through to a non-admin page', async () => {
      vi.mocked(getToken).mockResolvedValue({ invalid: false, role: 'VOLUNTEER' } as any);

      const res = await middleware(makeReq('/'));

      expect(res.status).toBe(200);
    });

    it('blocks a VOLUNTEER from /admin pages', async () => {
      vi.mocked(getToken).mockResolvedValue({ invalid: false, role: 'VOLUNTEER' } as any);

      const res = await middleware(makeReq('/admin/invites'));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/');
    });

    it('allows a COORDINATOR into /admin pages', async () => {
      vi.mocked(getToken).mockResolvedValue({ invalid: false, role: 'COORDINATOR' } as any);

      const res = await middleware(makeReq('/admin/invites'));

      expect(res.status).toBe(200);
    });
  });
});
