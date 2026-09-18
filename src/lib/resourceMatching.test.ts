import { describe, it, expect } from 'vitest';
import { availableCategoryIds, countMatchingNeeds } from './resourceMatching';

describe('availableCategoryIds', () => {
  it('includes a category only when some resource in it has free quantity', () => {
    const ids = availableCategoryIds([
      { categoryId: 'water', quantity: 10, reservedQuantity: 4 },
      { categoryId: 'equipment', quantity: 5, reservedQuantity: 5 },
    ]);
    expect(ids.has('water')).toBe(true);
    expect(ids.has('equipment')).toBe(false);
  });

  it('unions multiple resources in the same category', () => {
    const ids = availableCategoryIds([
      { categoryId: 'water', quantity: 5, reservedQuantity: 5 },
      { categoryId: 'water', quantity: 3, reservedQuantity: 0 },
    ]);
    expect(ids.has('water')).toBe(true);
  });

  it('returns an empty set for no resources', () => {
    expect(availableCategoryIds([]).size).toBe(0);
  });
});

describe('countMatchingNeeds', () => {
  const owned = new Set(['water', 'equipment']);

  it('counts open needs whose category the org has something available in', () => {
    const count = countMatchingNeeds(
      [
        { categoryId: 'water', status: 'OPEN' },
        { categoryId: 'equipment', status: 'PARTIALLY_FULFILLED' },
      ],
      owned
    );
    expect(count).toBe(2);
  });

  it('ignores needs in a category the org has nothing available in', () => {
    const count = countMatchingNeeds([{ categoryId: 'other', status: 'OPEN' }], owned);
    expect(count).toBe(0);
  });

  it('ignores needs that are already FULFILLED/CLOSED/CANCELLED even in a matching category', () => {
    const count = countMatchingNeeds(
      [
        { categoryId: 'water', status: 'FULFILLED' },
        { categoryId: 'water', status: 'CLOSED' },
        { categoryId: 'water', status: 'CANCELLED' },
      ],
      owned
    );
    expect(count).toBe(0);
  });
});
