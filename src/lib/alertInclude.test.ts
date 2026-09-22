import { describe, it, expect } from 'vitest';
import { alertInclude } from './alertInclude';

// Every field of User that must never reach the browser through the /map
// payload. Kept as an explicit list (not "anything but name") so a new
// sensitive column added to the model later shows up here as a conscious
// decision, not by accident.
const FORBIDDEN_USER_FIELDS = [
  'passwordHash',
  'email',
  'phone',
  'failedAttempts',
  'lockedUntil',
  'passwordChangedAt',
  'isActive',
  'deactivationReason',
  'lastActivatedAt',
  'lastDeactivatedAt',
  'emailVerified',
] as const;

// Recursively collects every relation that is `true` or `{ include: ... }`
// (i.e. "all scalars of the related row") instead of a narrow `select`.
function findBroadRelations(node: unknown, path: string[] = []): string[] {
  if (node === true) return [path.join('.')];
  if (typeof node !== 'object' || node === null) return [];

  const record = node as Record<string, unknown>;
  const out: string[] = [];
  if ('include' in record) out.push(path.join('.'));
  for (const [key, value] of Object.entries(record)) {
    if (key === 'select' || key === 'include') {
      for (const [relKey, relValue] of Object.entries(value as Record<string, unknown>)) {
        // Scalars selected as `true` inside a `select` are fine — only
        // relations matter, and a relation selected as `true` is broad.
        if (key === 'select' && relValue === true) continue;
        out.push(...findBroadRelations(relValue, [...path, relKey]));
      }
    }
  }
  return out;
}

describe('alertInclude (the /map RSC payload allowlist)', () => {
  it('selects only name + organization name for the author, never the whole User row', () => {
    expect(alertInclude.author).toEqual({
      select: {
        id: true,
        name: true,
        organization: { select: { id: true, name: true } },
      },
    });
  });

  it.each(FORBIDDEN_USER_FIELDS)('does not select author.%s', (field) => {
    expect(alertInclude.author.select).not.toHaveProperty(field);
  });

  it('selects only what the cards render from gmina (no contact details)', () => {
    expect(alertInclude.gmina).toEqual({
      select: { id: true, name: true, latitude: true, longitude: true },
    });
    expect(alertInclude.gmina.select).not.toHaveProperty('contactEmail');
    expect(alertInclude.gmina.select).not.toHaveProperty('contactPhone');
  });

  it('never expands a User relation to all of its scalars anywhere in the tree', () => {
    // Only User-backed relations are a leak risk (passwordHash etc.); the
    // nested need/allocation rows are intentionally `include`d in full.
    const userRelations = ['author', 'createdBy', 'recordedBy', 'authorId'];
    const broad = findBroadRelations({ include: alertInclude }).filter((p) =>
      userRelations.some((rel) => p.endsWith(rel))
    );
    expect(broad).toEqual([]);
  });
});
