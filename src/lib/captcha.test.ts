import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyCaptcha } from './captcha';

const ORIGINAL_SECRET = process.env.RECAPTCHA_SECRET_KEY;

describe('verifyCaptcha', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.RECAPTCHA_SECRET_KEY;
    } else {
      process.env.RECAPTCHA_SECRET_KEY = ORIGINAL_SECRET;
    }
  });

  it('allows the request through when RECAPTCHA_SECRET_KEY is not configured (dev/no-op mode)', async () => {
    delete process.env.RECAPTCHA_SECRET_KEY;

    const result = await verifyCaptcha('any-token', '1.2.3.4');

    expect(result).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects when no token is supplied but a secret is configured', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'test-secret';

    const result = await verifyCaptcha(undefined, '1.2.3.4');

    expect(result).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns true when Google reports success', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'test-secret';
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as any);

    const result = await verifyCaptcha('good-token', '1.2.3.4');

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/recaptcha/api/siteverify',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('returns false when Google reports failure', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'test-secret';
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ success: false }) } as any);

    expect(await verifyCaptcha('bad-token', '1.2.3.4')).toBe(false);
  });

  it('fails closed when the verification request errors out', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'test-secret';
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    expect(await verifyCaptcha('any-token', '1.2.3.4')).toBe(false);
  });

  it('fails closed when Google responds with a non-OK status', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'test-secret';
    vi.mocked(fetch).mockResolvedValue({ ok: false } as any);

    expect(await verifyCaptcha('any-token', '1.2.3.4')).toBe(false);
  });
});