// --- Resource module authz (docs/are-you-familiar-with-tidy-blum.md, розділ 4) ---
//
// Deliberately its own module, separate from lib/authz.ts: these four
// predicates are pure (plain objects in, boolean out) and take no dependency
// on next-auth/prisma/ioredis, unlike the rest of authz.ts (getServerSession,
// requireAdmin, etc.). That matters because AlertsMapView.tsx — a 'use
// client' component (Крок 46) — needs canManageAlert/isAlertOwnerOrg to
// render the same authorization the server enforces; importing them from
// authz.ts directly would drag its whole module graph (next-auth -> lib/auth
// -> lib/ipLockout -> ioredis) into the browser bundle, which fails to build
// since ioredis needs Node builtins ('net', 'tls', 'dns', 'fs') the browser
// doesn't have. authz.ts re-exports these for every existing server-side
// caller, so this split is invisible to them.

/**
 * Whether `user`'s organization is the one that owns `alert` — i.e. the
 * "recipient" side of every resource-allocation decision (R2/R7): the
 * organization that can mark a delivery received, agree to a return, or see
 * "Powrót zasoby" on the alert's card. `alert.organizationId` is set once at
 * creation (Крок 30) and never changes afterwards.
 */
export function isAlertOwnerOrg(
  alert: { organizationId: string | null },
  user: { organizationId?: string | null }
): boolean {
  return !!user.organizationId && alert.organizationId === user.organizationId;
}

/**
 * Whether `user`'s organization is the donor on `alloc` — gates "Przydziel
 * zasoby" (creating a new allocation) and, together with
 * isAllocationRecipient, the DELIVERY_AGREED → DELIVERED transition (either
 * side may confirm delivery — decision #3).
 */
export function isAllocationDonor(
  alloc: { donorOrgId: string },
  user: { organizationId?: string | null }
): boolean {
  return !!user.organizationId && alloc.donorOrgId === user.organizationId;
}

/**
 * Whether `user`'s organization is the recipient on `alloc` — i.e. the
 * organization that owns the alert this allocation was made for. Reuses
 * isAlertOwnerOrg rather than comparing against `alloc.recipientOrgId`
 * directly: that field is only a point-in-time snapshot, while
 * `alloc.alert.organizationId` is the live source of truth (decision #3).
 * Gates DELIVERED (together with the donor) and, alone, RETURN_AGREED plus
 * every return-recording action (R1/R2) — only the recipient physically
 * returns a resource it no longer needs.
 */
export function isAllocationRecipient(
  alloc: { alert: { organizationId: string | null } },
  user: { organizationId?: string | null }
): boolean {
  return isAlertOwnerOrg(alloc.alert, user);
}

/**
 * Whether `user`'s organization has donated at least one resource to `alert`
 * — i.e. it shows up as `donorOrgId` on one of the alert's allocations,
 * regardless of that allocation's status or which need it was made against.
 * Gates replying in the alert's operational journal/forum thread
 * (canReplyToAlertForum below), alongside the owner org and ADMIN/COORDINATOR
 * — the same broad "everyone involved" group the original flat-forum design
 * (R12) allowed to write, now that a narrower group (ADMIN/COORDINATOR only)
 * is required to start a new root entry ("wpis").
 */
export function isAlertDonorOrg(
  alert: { allocations: { donorOrgId: string }[] },
  user: { organizationId?: string | null }
): boolean {
  return !!user.organizationId && alert.allocations.some((alloc) => alloc.donorOrgId === user.organizationId);
}

/**
 * Whether `user` may create a new root entry ("wpis") in an alert's
 * operational journal/forum — deliberately narrower than who may reply to
 * one (canReplyToAlertForum below): only ADMIN/COORDINATOR run the journal,
 * per the user's decision when refining Фаза 8 of
 * docs/resource_management_plan.md (Крок 52).
 */
export function canPostAlertJournalEntry(user: { role: string }): boolean {
  return user.role === 'ADMIN' || user.role === 'COORDINATOR';
}

/**
 * Whether `user` may post a reply in the chat thread under an existing
 * journal entry — the same broad group the original flat-forum design (R12)
 * allowed to write: the alert's owner org, any org that donated to it, or
 * ADMIN/COORDINATOR. Deliberately not role-gated for org members (a
 * VOLUNTEER whose organization owns or donated to the alert can still
 * reply) — only creating the root entry itself is restricted to
 * ADMIN/COORDINATOR (canPostAlertJournalEntry above).
 */
export function canReplyToAlertForum(
  alert: { organizationId: string | null; allocations: { donorOrgId: string }[] },
  user: { role: string; organizationId?: string | null }
): boolean {
  return canPostAlertJournalEntry(user) || isAlertOwnerOrg(alert, user) || isAlertDonorOrg(alert, user);
}

/**
 * Whether `user` may manage (edit/resolve/cancel) `alert` — gates "Edytuj",
 * "Rozwiąż" and "Odwołaj" on the alert's card (client, AlertsMapView.tsx) and
 * PATCH /api/alerts/[id] (server) alike, from this single source of truth.
 * ADMIN always can; VOLUNTEER never can. A COORDINATOR can manage it only if
 * their own organization created it (isAlertOwnerOrg) — deliberately
 * narrower than the original gmina-wide rule (any coordinator in the same
 * gmina could manage any alert there), which predates the organization model
 * and let coordinators edit/resolve/cancel alerts that weren't theirs.
 */
export function canManageAlert(
  alert: { organizationId: string | null },
  user: { role: string; organizationId?: string | null }
): boolean {
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'COORDINATOR') return false;
  return isAlertOwnerOrg(alert, user);
}
