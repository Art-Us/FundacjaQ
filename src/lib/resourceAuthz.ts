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
 * Whether `user` is an ADMIN empowered to act on something that belongs to
 * `gminaId` — true for a global ADMIN (gminaId === null on the user)
 * unconditionally, true for a gmina-scoped ADMIN only when it matches their
 * own gminaId, false for every other role. Every call site below combines
 * this with its own org/ownership check for COORDINATOR (and, where
 * relevant, VOLUNTEER) — this only ever narrows what used to be a blanket
 * `role === 'ADMIN'` bypass, it never widens anyone else's access.
 */
export function isAdminForGmina(user: { role: string; gminaId?: string | null }, gminaId: string | null): boolean {
  if (user.role !== 'ADMIN') return false;
  if (!user.gminaId) return true;
  return user.gminaId === gminaId;
}

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
 * Whether `user` may edit the quantity of `alloc` — fixing a typo'd digit
 * before the other side has acted on it. Deliberately narrower than
 * isAllocationDonor alone: allowed only while the allocation still sits in
 * DELIVERY_AGREED (the donor's own initial declaration, not yet confirmed by
 * either side per decision #3) — once DELIVERED, the recipient may already be
 * relying on that exact amount, so a correction past that point has to go
 * through a fresh allocation/return instead of silently rewriting history.
 * Same gmina-scoped admin carve-out as the rest of the module
 * (isAdminForGmina); the recipient side is never allowed to edit someone
 * else's declared donation.
 */
export function canEditAllocationQuantity(
  alloc: { status: string; donorOrgId: string; alert: { gminaId: string } },
  user: { role: string; gminaId?: string | null; organizationId?: string | null }
): boolean {
  if (alloc.status !== 'DELIVERY_AGREED') return false;
  if (isAdminForGmina(user, alloc.alert.gminaId)) return true;
  return isAllocationDonor(alloc, user);
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
 * Whether `user` may see an alert's operational journal/forum at all — the
 * same gmina-scoped visibility rule that decides whether the alert itself
 * shows up on the map (scopedGminaWhere, lib/gmina.ts; a global admin
 * unconditionally, a gmina-scoped one only within their own gmina via
 * isAdminForGmina), just re-checked against one already-fetched alert
 * instead of filtering a list. Shared by both journal endpoints (Крок 53's
 * root-entry route and Крок 54's replies route) so the two don't each carry
 * their own copy of this check. Deliberately broader than the rest of the
 * resource module (requireAdminOrCoordinator + the hard /zasoby perimeter,
 * Крок 31) — the journal inherits the alert's own visibility, VOLUNTEER
 * included (see docs/are-you-familiar-with-tidy-blum.md, розділ 4, "Форум
 * алерту — окремий, м'якший периметр").
 */
export function canViewAlertJournal(
  alert: { gminaId: string },
  user: { role: string; gminaId: string | null }
): boolean {
  return isAdminForGmina(user, alert.gminaId) || alert.gminaId === user.gminaId;
}

/**
 * Whether `user` may post a reply in the chat thread under an existing
 * journal entry — the same broad group the original flat-forum design (R12)
 * allowed to write: the alert's owner org, any org that donated to it (in
 * EITHER case regardless of gmina — crisis response crosses gmina
 * boundaries, same as donating in the first place), a COORDINATOR in the
 * alert's own gmina, or an ADMIN empowered for that gmina (isAdminForGmina).
 * Deliberately not role-gated for org members (a VOLUNTEER whose
 * organization owns or donated to the alert can still reply) — only
 * creating the root entry itself is restricted to ADMIN/COORDINATOR
 * (canPostAlertJournalEntry above), and that route additionally checks
 * canViewAlertJournal for the gmina gate this function applies inline
 * instead (this one has no separate caller-side check to lean on).
 */
export function canReplyToAlertForum(
  alert: { gminaId: string; organizationId: string | null; allocations: { donorOrgId: string }[] },
  user: { role: string; gminaId?: string | null; organizationId?: string | null }
): boolean {
  if (isAdminForGmina(user, alert.gminaId)) return true;
  if (user.role === 'COORDINATOR' && alert.gminaId === user.gminaId) return true;
  return isAlertOwnerOrg(alert, user) || isAlertDonorOrg(alert, user);
}

/**
 * Whether `user` may manage (edit/resolve/cancel) `alert` — gates "Edytuj",
 * "Rozwiąż" and "Odwołaj" on the alert's card (client, AlertsMapView.tsx) and
 * PATCH /api/alerts/[id] (server) alike, from this single source of truth.
 * A global ADMIN always can; a gmina-scoped ADMIN only within their own
 * gmina (isAdminForGmina); VOLUNTEER never can. A COORDINATOR can manage it
 * only if their own organization created it (isAlertOwnerOrg) — deliberately
 * narrower than the original gmina-wide rule (any coordinator in the same
 * gmina could manage any alert there), which predates the organization model
 * and let coordinators edit/resolve/cancel alerts that weren't theirs.
 */
export function canManageAlert(
  alert: { organizationId: string | null; gminaId: string },
  user: { role: string; organizationId?: string | null; gminaId?: string | null }
): boolean {
  if (isAdminForGmina(user, alert.gminaId)) return true;
  if (user.role !== 'COORDINATOR') return false;
  return isAlertOwnerOrg(alert, user);
}
