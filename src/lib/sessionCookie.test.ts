import { describe, it, expect, afterEach, vi } from 'vitest';

// SESSION_COOKIE_NAME is computed once, at module load time, from
// process.env.NODE_ENV. To exercise both branches we must force the module
// body to re-execute under each env value: reset the module registry and
// stub NODE_ENV before each fresh dynamic import.
describe('SESSION_COOKIE_NAME', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the non-prefixed cookie name outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.resetModules();
    const { SESSION_COOKIE_NAME } = await import('./sessionCookie');
    expect(SESSION_COOKIE_NAME).toBe('next-auth.session-token');
  });

  it('uses the __Host-prefixed cookie name in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { SESSION_COOKIE_NAME } = await import('./sessionCookie');
    expect(SESSION_COOKIE_NAME).toBe('__Host-next-auth.session-token');
  });
});
