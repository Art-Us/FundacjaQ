import type { NeedStatus } from '@prisma/client';

interface OwnedResourceLike {
  categoryId: string;
  quantity: number;
  reservedQuantity: number;
}

interface NeedLike {
  categoryId: string;
  status: NeedStatus;
}

// A need still worth flagging to a would-be donor — FULFILLED/CLOSED/
// CANCELLED already have all the help they're going to accept (Крок 22/28
// decide that deliberately; a donor offering more at that point wouldn't be
// acted on server-side anyway, see Крок 23's OPEN/PARTIALLY_FULFILLED gate).
const OPEN_NEED_STATUSES: ReadonlySet<NeedStatus> = new Set<NeedStatus>(['OPEN', 'PARTIALLY_FULFILLED']);

/**
 * Which of an organization's own resource categories currently have
 * anything free to give — a category counts only if at least one of the
 * org's resources in it has `quantity > reservedQuantity`. Used as the
 * lookup set for `countMatchingNeeds` below, so it's computed once per
 * organization rather than per alert.
 */
export function availableCategoryIds(resources: OwnedResourceLike[]): Set<string> {
  const ids = new Set<string>();
  for (const resource of resources) {
    if (resource.quantity - resource.reservedQuantity > 0) {
      ids.add(resource.categoryId);
    }
  }
  return ids;
}

/**
 * "Masz zasoby (N)" (R11) — how many of an alert's still-open needs fall in
 * a category the caller's own organization currently has something
 * available in. Purely a discovery hint for the donor UI: it doesn't imply
 * the org holds enough quantity, or the right specific item, only that it's
 * worth a look.
 */
export function countMatchingNeeds(needs: NeedLike[], ownedCategoryIds: Set<string>): number {
  return needs.filter((need) => OPEN_NEED_STATUSES.has(need.status) && ownedCategoryIds.has(need.categoryId)).length;
}
