import { describe, it, expect } from 'vitest';
import { isProtectedApiPath } from './apiUnauthorized';

describe('isProtectedApiPath', () => {
  it.each(['/api/admin/users', '/api/resources/matrix', '/api/alerts/abc123'])(
    'is true for a protected API route (%s)',
    (pathname) => {
      expect(isProtectedApiPath(pathname)).toBe(true);
    }
  );

  it.each(['/api/auth/session', '/api/auth/signin', '/api/auth/callback/credentials'])(
    'is false for a NextAuth route (%s)',
    (pathname) => {
      expect(isProtectedApiPath(pathname)).toBe(false);
    }
  );

  it.each(['/login', '/admin/users', '/'])('is false for a page route (%s)', (pathname) => {
    expect(isProtectedApiPath(pathname)).toBe(false);
  });
});
