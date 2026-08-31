import { describe, it, expect } from 'vitest';
import {
  generateToken,
  hashToken,
  INVITE_TOKEN_TTL_MS,
  INVITE_TOKEN_MAX_TTL_MS,
  RESET_TOKEN_TTL_MS,
} from './tokens';

describe('generateToken', () => {
  it('produces a base64url string with no padding/unsafe characters', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it('never produces the same token twice across many calls', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generateToken()));
    expect(tokens.size).toBe(2000);
  });
});

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('produces a 64-character lowercase hex string (sha256)', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never returns the raw input unchanged', () => {
    const token = 'not-a-hash-yet';
    expect(hashToken(token)).not.toBe(token);
  });
});

describe('TTL constants', () => {
  it('keeps the reset token short-lived (30 minutes)', () => {
    expect(RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('keeps the default invite TTL under the hard maximum', () => {
    expect(INVITE_TOKEN_TTL_MS).toBeLessThan(INVITE_TOKEN_MAX_TTL_MS);
  });

  it('keeps the reset token TTL shorter than the invite TTL', () => {
    expect(RESET_TOKEN_TTL_MS).toBeLessThan(INVITE_TOKEN_TTL_MS);
  });
});
