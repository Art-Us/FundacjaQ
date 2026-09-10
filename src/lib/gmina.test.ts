import { describe, it, expect } from 'vitest';
import { requiresGmina, scopedGminaWhere } from './gmina';

describe('requiresGmina', () => {
  it('is false for ADMIN', () => {
    expect(requiresGmina('ADMIN')).toBe(false);
  });

  it('is true for COORDINATOR and VOLUNTEER', () => {
    expect(requiresGmina('COORDINATOR')).toBe(true);
    expect(requiresGmina('VOLUNTEER')).toBe(true);
  });
});

// Regression coverage for the 2026-09-10 audit finding: admin/invites/page.tsx,
// admin/users/page.tsx and lib/dashboard.ts all used to compute their gmina
// filter as `isAdmin || !actor.gminaId ? {} : { gminaId: actor.gminaId }`.
// For a gmina-scoped actor (COORDINATOR/VOLUNTEER) with no gmina of their
// own, that fell through to the *unfiltered* `{}` branch — handing them the
// same unrestricted, all-gminy view as an ADMIN. scopedGminaWhere replaces
// that pattern and must fail closed (return null, meaning "show nothing")
// in exactly that case.
describe('scopedGminaWhere', () => {
  it('returns an unfiltered {} for ADMIN regardless of gminaId', () => {
    expect(scopedGminaWhere({ role: 'ADMIN', gminaId: null })).toEqual({});
    expect(scopedGminaWhere({ role: 'ADMIN', gminaId: 'gmina-1' })).toEqual({});
  });

  it('scopes COORDINATOR/VOLUNTEER to their own gmina when they have one', () => {
    expect(scopedGminaWhere({ role: 'COORDINATOR', gminaId: 'gmina-1' })).toEqual({ gminaId: 'gmina-1' });
    expect(scopedGminaWhere({ role: 'VOLUNTEER', gminaId: 'gmina-2' })).toEqual({ gminaId: 'gmina-2' });
  });

  it('fails closed (returns null, never {}) for a gmina-scoped role with no gmina', () => {
    expect(scopedGminaWhere({ role: 'COORDINATOR', gminaId: null })).toBeNull();
    expect(scopedGminaWhere({ role: 'VOLUNTEER', gminaId: null })).toBeNull();
  });
});
