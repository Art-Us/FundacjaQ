import { describe, it, expect } from 'vitest';
import { parseClientIp } from './clientIp';

describe('parseClientIp', () => {
  it('returns the single IP when there is only one hop', () => {
    expect(parseClientIp('1.2.3.4')).toBe('1.2.3.4');
  });

  it('returns the last hop, not the client-supplied first one', () => {
    // A spoofed leading entry (attacker-controlled) followed by Azure's own
    // appended hop — the real client IP as Azure's edge observed it.
    expect(parseClientIp('9.9.9.9, 1.2.3.4')).toBe('1.2.3.4');
  });

  it('trims whitespace around hops', () => {
    expect(parseClientIp(' 9.9.9.9 ,  1.2.3.4 ')).toBe('1.2.3.4');
  });

  it('falls back to "unknown" when the header is missing or empty', () => {
    expect(parseClientIp(null)).toBe('unknown');
    expect(parseClientIp(undefined)).toBe('unknown');
    expect(parseClientIp('')).toBe('unknown');
  });
});
