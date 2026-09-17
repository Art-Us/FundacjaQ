import type { AllocationStatus, NeedStatus } from '@prisma/client';

/** Thrown by assertAllocationTransition when a status change isn't allowed at all, or not for the actor attempting it. */
export class AllocationTransitionError extends Error {}

export type AllocationActor = 'DONOR' | 'RECIPIENT';

interface ReturnEventLike {
  quantityReturned: number;
  quantityNotReturnable: number;
}

/** Sums quantityReturned/quantityNotReturnable across every AllocationReturnEvent recorded for one allocation. */
export function sumReturnEvents(events: ReturnEventLike[]): { totalReturned: number; totalNotReturnable: number } {
  return events.reduce(
    (acc, event) => ({
      totalReturned: acc.totalReturned + event.quantityReturned,
      totalNotReturnable: acc.totalNotReturnable + event.quantityNotReturnable,
    }),
    { totalReturned: 0, totalNotReturnable: 0 }
  );
}

/**
 * Recomputes a ResourceAllocation's status from its full return-event
 * history — formula from docs/are-you-familiar-with-tidy-blum.md: nothing
 * returned or written off yet → status is unchanged (still DELIVERED/
 * RETURN_AGREED); some but not all of `quantity` accounted for →
 * PARTIALLY_RETURNED; all of it accounted for (returned and/or written off
 * as not returnable) → RETURNED — terminal either way.
 */
export function recalculateAllocationStatus(
  quantity: number,
  events: ReturnEventLike[],
  currentStatus: AllocationStatus
): AllocationStatus {
  const { totalReturned, totalNotReturnable } = sumReturnEvents(events);
  const accountedFor = totalReturned + totalNotReturnable;

  if (accountedFor <= 0) return currentStatus;
  if (accountedFor < quantity) return 'PARTIALLY_RETURNED';
  return 'RETURNED';
}

/**
 * How much to release from Resource.reservedQuantity and permanently deduct
 * from Resource.quantity when recording ONE new AllocationReturnEvent (see
 * "Правило оновлення лічильників" in docs/are-you-familiar-with-tidy-blum.md).
 * Only this event's own quantities matter — the reservation for any
 * earlier return event on the same allocation was already released when
 * that event was processed, so summing the whole history again here would
 * double-count it.
 */
export function resourceCountersAfterReturnEvent(event: ReturnEventLike): {
  reservedQuantityDelta: number;
  quantityDelta: number;
} {
  return {
    // `|| 0` normalizes a would-be `-0` (e.g. when both inputs are 0) to a
    // plain `0` — same value either way, but keeps callers' equality checks
    // (and any downstream `-0`-sensitive comparison) unsurprising.
    reservedQuantityDelta: -(event.quantityReturned + event.quantityNotReturnable) || 0,
    quantityDelta: -event.quantityNotReturnable || 0,
  };
}

// Scoped to exactly the two manual transitions /api/allocations/[id] (Крок
// 24) exposes via PATCH. PARTIALLY_RETURNED/RETURNED are reached
// automatically through recalculateAllocationStatus above, never through
// this manual gate — and CANCELLED has no route anywhere in this plan yet,
// so it's deliberately left out rather than guessed at.
const ALLOWED_TRANSITIONS: Partial<Record<AllocationStatus, Partial<Record<AllocationStatus, AllocationActor[]>>>> = {
  DELIVERY_AGREED: { DELIVERED: ['DONOR', 'RECIPIENT'] },
  DELIVERED: { RETURN_AGREED: ['RECIPIENT'] },
};

/**
 * Throws unless `actor` may move an allocation from `current` to `next` —
 * decision #3 (docs/are-you-familiar-with-tidy-blum.md): either side may
 * confirm delivery, but only the recipient may agree to a return.
 */
export function assertAllocationTransition(
  current: AllocationStatus,
  next: AllocationStatus,
  actor: AllocationActor
): void {
  const allowedActors = ALLOWED_TRANSITIONS[current]?.[next];
  if (!allowedActors) {
    throw new AllocationTransitionError(`Nie można przejść ze statusu ${current} do ${next}.`);
  }
  if (!allowedActors.includes(actor)) {
    throw new AllocationTransitionError(
      actor === 'DONOR' ? 'Tylko odbiorca może wykonać tę zmianę statusu.' : 'Tylko dawca może wykonać tę zmianę statusu.'
    );
  }
}

/**
 * Recomputes an AlertNeed's fulfilled quantity and status from its
 * allocations (Крок 23) — CANCELLED allocations don't count, since a
 * withdrawn-before-delivery promise never actually covered the need. Never
 * overrides a terminal need status (CLOSED/CANCELLED, set explicitly via
 * Крок 22/28): those reflect a deliberate decision by the alert's owning
 * org, not something a new allocation should silently reopen.
 */
export function recalculateNeedFulfillment(
  quantityNeeded: number,
  allocations: { status: AllocationStatus; quantity: number }[],
  currentNeedStatus: NeedStatus
): { quantityFulfilled: number; status: NeedStatus } {
  const quantityFulfilled = allocations
    .filter((allocation) => allocation.status !== 'CANCELLED')
    .reduce((sum, allocation) => sum + allocation.quantity, 0);

  if (currentNeedStatus === 'CLOSED' || currentNeedStatus === 'CANCELLED') {
    return { quantityFulfilled, status: currentNeedStatus };
  }

  const status: NeedStatus =
    quantityFulfilled <= 0 ? 'OPEN' : quantityFulfilled < quantityNeeded ? 'PARTIALLY_FULFILLED' : 'FULFILLED';

  return { quantityFulfilled, status };
}
