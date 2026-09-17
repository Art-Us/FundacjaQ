import { describe, it, expect } from 'vitest';
import {
  recalculateAllocationStatus,
  resourceCountersAfterReturnEvent,
  assertAllocationTransition,
  recalculateNeedFulfillment,
  AllocationTransitionError,
} from './allocations';

describe('recalculateAllocationStatus', () => {
  it('keeps the current status when nothing has been accounted for yet', () => {
    expect(recalculateAllocationStatus(5, [], 'DELIVERED')).toBe('DELIVERED');
    expect(
      recalculateAllocationStatus(5, [{ quantityReturned: 0, quantityNotReturnable: 0 }], 'RETURN_AGREED')
    ).toBe('RETURN_AGREED');
  });

  it('is PARTIALLY_RETURNED when some but not all of the quantity is accounted for (partial return)', () => {
    const result = recalculateAllocationStatus(5, [{ quantityReturned: 3, quantityNotReturnable: 0 }], 'RETURN_AGREED');
    expect(result).toBe('PARTIALLY_RETURNED');
  });

  it('is RETURNED once the full quantity is returned (full return)', () => {
    const result = recalculateAllocationStatus(5, [{ quantityReturned: 5, quantityNotReturnable: 0 }], 'RETURN_AGREED');
    expect(result).toBe('RETURNED');
  });

  it('is RETURNED once the full quantity is written off as not returnable', () => {
    const result = recalculateAllocationStatus(5, [{ quantityReturned: 0, quantityNotReturnable: 5 }], 'RETURN_AGREED');
    expect(result).toBe('RETURNED');
  });

  it('is RETURNED when returned + not-returnable together cover the full quantity, across multiple events', () => {
    const events = [
      { quantityReturned: 3, quantityNotReturnable: 0 },
      { quantityReturned: 0, quantityNotReturnable: 2 },
    ];
    expect(recalculateAllocationStatus(5, events, 'PARTIALLY_RETURNED')).toBe('RETURNED');
  });

  it('is PARTIALLY_RETURNED when returned + not-returnable together are still short of the full quantity', () => {
    const events = [
      { quantityReturned: 2, quantityNotReturnable: 1 },
    ];
    expect(recalculateAllocationStatus(5, events, 'RETURN_AGREED')).toBe('PARTIALLY_RETURNED');
  });
});

describe('resourceCountersAfterReturnEvent', () => {
  it('releases the reservation for a plain return, without touching total quantity', () => {
    expect(resourceCountersAfterReturnEvent({ quantityReturned: 3, quantityNotReturnable: 0 })).toEqual({
      reservedQuantityDelta: -3,
      quantityDelta: 0,
    });
  });

  it('releases the reservation AND permanently deducts total quantity for a not-returnable amount', () => {
    expect(resourceCountersAfterReturnEvent({ quantityReturned: 0, quantityNotReturnable: 2 })).toEqual({
      reservedQuantityDelta: -2,
      quantityDelta: -2,
    });
  });

  it('combines both effects for a mixed return event', () => {
    expect(resourceCountersAfterReturnEvent({ quantityReturned: 3, quantityNotReturnable: 2 })).toEqual({
      reservedQuantityDelta: -5,
      quantityDelta: -2,
    });
  });
});

describe('assertAllocationTransition', () => {
  it('allows either the donor or the recipient to confirm delivery', () => {
    expect(() => assertAllocationTransition('DELIVERY_AGREED', 'DELIVERED', 'DONOR')).not.toThrow();
    expect(() => assertAllocationTransition('DELIVERY_AGREED', 'DELIVERED', 'RECIPIENT')).not.toThrow();
  });

  it('allows only the recipient to agree to a return', () => {
    expect(() => assertAllocationTransition('DELIVERED', 'RETURN_AGREED', 'RECIPIENT')).not.toThrow();
  });

  it('throws when the donor tries to agree to a return (recipient-only action)', () => {
    expect(() => assertAllocationTransition('DELIVERED', 'RETURN_AGREED', 'DONOR')).toThrow(AllocationTransitionError);
  });

  it('throws for a transition that skips a step', () => {
    expect(() => assertAllocationTransition('DELIVERY_AGREED', 'RETURN_AGREED', 'RECIPIENT')).toThrow(
      AllocationTransitionError
    );
  });

  it('throws for a transition out of a terminal status', () => {
    expect(() => assertAllocationTransition('RETURNED', 'DELIVERED', 'DONOR')).toThrow(AllocationTransitionError);
  });
});

describe('recalculateNeedFulfillment', () => {
  const allocation = (status: 'DELIVERY_AGREED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED', quantity: number) => ({
    status,
    quantity,
  });

  it('is OPEN when nothing has been allocated', () => {
    expect(recalculateNeedFulfillment(10, [], 'OPEN')).toEqual({ quantityFulfilled: 0, status: 'OPEN' });
  });

  it('is PARTIALLY_FULFILLED when allocations cover less than what is needed', () => {
    const result = recalculateNeedFulfillment(10, [allocation('DELIVERED', 4)], 'OPEN');
    expect(result).toEqual({ quantityFulfilled: 4, status: 'PARTIALLY_FULFILLED' });
  });

  it('is FULFILLED when allocations cover the full needed quantity', () => {
    const result = recalculateNeedFulfillment(10, [allocation('DELIVERY_AGREED', 6), allocation('DELIVERED', 4)], 'OPEN');
    expect(result).toEqual({ quantityFulfilled: 10, status: 'FULFILLED' });
  });

  it('ignores CANCELLED allocations when summing fulfilled quantity', () => {
    const result = recalculateNeedFulfillment(
      10,
      [allocation('DELIVERED', 4), allocation('CANCELLED', 10)],
      'OPEN'
    );
    expect(result).toEqual({ quantityFulfilled: 4, status: 'PARTIALLY_FULFILLED' });
  });

  it('never reopens a need that was explicitly CLOSED', () => {
    const result = recalculateNeedFulfillment(10, [allocation('DELIVERED', 10)], 'CLOSED');
    expect(result).toEqual({ quantityFulfilled: 10, status: 'CLOSED' });
  });

  it('never reopens a need that was explicitly CANCELLED', () => {
    const result = recalculateNeedFulfillment(10, [], 'CANCELLED');
    expect(result).toEqual({ quantityFulfilled: 0, status: 'CANCELLED' });
  });
});
