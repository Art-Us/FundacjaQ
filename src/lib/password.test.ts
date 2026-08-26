import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashPassword, verifyPassword, passwordSchema, isPasswordPwned } from './password';

describe('hashPassword / verifyPassword', () => {
  it('hashes to a different value than the plaintext', async () => {
    const hash = await hashPassword('CorrectHorseBattery1!');
    expect(hash).not.toBe('CorrectHorseBattery1!');
  });

  it('salts each hash differently even for the same password', async () => {
    const a = await hashPassword('SamePassword12345');
    const b = await hashPassword('SamePassword12345');
    expect(a).not.toBe(b);
  });

  it('verifies the correct password against its hash', async () => {
    const hash = await hashPassword('MyStrongPassword2026');
    await expect(verifyPassword('MyStrongPassword2026', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('MyStrongPassword2026');
    await expect(verifyPassword('WrongPassword2026', hash)).resolves.toBe(false);
  });

  it('rejects an injection-shaped password string without throwing', async () => {
    const hash = await hashPassword('MyStrongPassword2026');
    await expect(verifyPassword("' OR '1'='1", hash)).resolves.toBe(false);
  });
});

describe('passwordSchema', () => {
  it('rejects 11 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(11)).success).toBe(false);
  });

  it('accepts exactly 12 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true);
  });

  it('accepts exactly 128 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true);
  });

  it('rejects 129 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(passwordSchema.safeParse('').success).toBe(false);
  });

  it('rejects a 10,000-character string (oversized-input guard)', () => {
    expect(passwordSchema.safeParse('a'.repeat(10_000)).success).toBe(false);
  });
});

describe('isPasswordPwned', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns true when the suffix appears in the HIBP range response', async () => {
    // sha1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 -> prefix 5BAA6, suffix below
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:12345\nOTHERSUFFIX00000000000000000000:1',
    });

    await expect(isPasswordPwned('password')).resolves.toBe(true);
  });

  it('returns false when no suffix matches', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: async () => 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1',
    });

    await expect(isPasswordPwned('SomeUniquePassword2026!')).resolves.toBe(false);
  });

  it('fails open (false) when the API returns a non-200 status', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    await expect(isPasswordPwned('anything')).resolves.toBe(false);
  });

  it('fails open (false) when the network request throws', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    await expect(isPasswordPwned('anything')).resolves.toBe(false);
  });

  it('fails open (false) on an abort/timeout', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(isPasswordPwned('anything')).resolves.toBe(false);
  });

  it('never sends more than the 5-character SHA-1 prefix in the request URL', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => '' });

    await isPasswordPwned('MySecretPassword2026!');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const prefix = calledUrl.split('/').pop()!;
    expect(prefix).toHaveLength(5);
    expect(calledUrl).not.toContain('MySecretPassword2026!');
  });
});
