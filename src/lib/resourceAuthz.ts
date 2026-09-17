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
 * Whether `user` may manage (edit/cancel/etc.) `alert` — replaces the old
 * gmina-only check inline in AlertsMapView.tsx (`alert.gminaId ===
 * currentUserGminaId`), which had no concept of organizations at all. ADMIN
 * always can; VOLUNTEER never can (mirrors every other admin-style action in
 * this codebase — nothing here grants a volunteer alert-management rights
 * just because their organization happens to own the alert). A COORDINATOR
 * can manage it either because their organization owns it (isAlertOwnerOrg —
 * covers e.g. an org operating across more than one gmina) or, as before,
 * because the alert is in their own gmina.
 */
export function canManageAlert(
  alert: { organizationId: string | null; gminaId: string },
  user: { role: string; gminaId: string | null; organizationId?: string | null }
): boolean {
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'COORDINATOR') return false;
  return isAlertOwnerOrg(alert, user) || alert.gminaId === user.gminaId;
}
