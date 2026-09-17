import { describe, it, expect } from 'vitest';
import { parseClientIp } from './clientIp';

// parseClientIp trusts exactly one hop appended by Azure's front-end proxy —
// see the doc comment in clientIp.ts. That hop is always the LAST entry in a
// comma-separated X-Forwarded-For header, since everything before it is
// client-supplied and spoofable.
describe('parseClientIp', () => {
  it('returns the IP from a normal single-IP header', () => {
    expect(parseClientIp('203.0.113.5')).toBe('203.0.113.5');
  });

  it('picks the last hop from a multi-hop comma-separated header', () => {
    expect(parseClientIp('203.0.113.5, 10.0.0.1, 10.0.0.2')).toBe('10.0.0.2');
  });

  it('returns "unknown" for a null header', () => {
    expect(parseClientIp(null)).toBe('unknown');
  });

  it('returns "unknown" for an undefined header', () => {
    expect(parseClientIp(undefined)).toBe('unknown');
  });

  it('returns "unknown" for an empty string header', () => {
    expect(parseClientIp('')).toBe('unknown');
  });

  it('returns "unknown" when the header contains only commas', () => {
    // Splits into ['', ''], each trimmed and filtered out as falsy, leaving
    // an empty hops array — hops[hops.length - 1] is undefined, so the ??
    // fallback must kick in.
    expect(parseClientIp(',')).toBe('unknown');
  });

  it('returns "unknown" when the header contains only commas and whitespace', () => {
    expect(parseClientIp(' , , ')).toBe('unknown');
  });
});
