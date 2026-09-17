import { describe, it, expect } from 'vitest';
import { escapeLikePattern } from './utils';

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
