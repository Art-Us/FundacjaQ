import { describe, it, expect } from 'vitest';
import { cn, escapeLikePattern, formatDate } from './utils';

describe('cn', () => {
  it('merges plain class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('drops falsy/conditional values', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });

  it('dedupes a conflicting Tailwind utility, keeping the last one', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});

describe('formatDate', () => {
  // Fixed, deterministic instant: 5 March 2024, 14:30. Constructed via the
  // local-time constructor (not a UTC string) so the Date object and the
  // equivalent local-time ISO string below represent the same wall-clock
  // moment regardless of the machine's timezone.
  const fixedDate = new Date(2024, 2, 5, 14, 30);
  const expected = '05.03.2024, 14:30';

  it('formats a Date object input in pl-PL day/month/year + 2-digit hour/minute', () => {
    expect(formatDate(fixedDate)).toBe(expected);
  });

  it('formats a string input by constructing a Date from it', () => {
    expect(formatDate('2024-03-05T14:30:00')).toBe(expected);
  });
});

// escapeLikePattern exists to neutralize Postgres (I)LIKE wildcards (`%`, `_`)
// and the backslash escape character itself before a user-supplied search
// term is used in a Prisma `contains` filter — see the doc comment in
// utils.ts. Escaping backslashes first (before escaping % and _) matters:
// escaping in the other order would double-escape the backslashes just
// introduced by the %/_ substitutions and corrupt the pattern.
describe('escapeLikePattern', () => {
  it('leaves a plain string with no special characters unchanged', () => {
    expect(escapeLikePattern('jan.kowalski')).toBe('jan.kowalski');
  });

  it('escapes a literal % wildcard', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('escapes a literal _ wildcard', () => {
    expect(escapeLikePattern('jan_kowalski')).toBe('jan\\_kowalski');
  });

  it('escapes a literal backslash', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('escapes backslashes before %/_ so the result does not double-escape or corrupt itself', () => {
    // Input already contains a backslash immediately followed by a wildcard
    // character. Backslash must be escaped first (\ -> \\), then % and _
    // escaped independently — never re-escaping the backslashes just added.
    expect(escapeLikePattern('a\\_b')).toBe('a\\\\\\_b');
    expect(escapeLikePattern('a\\%b')).toBe('a\\\\\\%b');
  });

  it('returns an empty string unchanged', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});
