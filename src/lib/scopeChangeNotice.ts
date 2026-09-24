import type { Prisma } from '@prisma/client';
import { publishAdminEvent } from '@/lib/adminEvents';

/**
 * Persisted on User.pendingScopeChangeNotice (a one-shot mailbox, not a
 * log — see the schema.prisma doc comment) and rendered by
 * components/layout/ScopeChangeNoticeModal.tsx. Names, not ids: by the time
 * a user reads this, the org/gmina it refers to may have been renamed or
 * (for the FROM side) deleted, so the human-readable string is captured at
 * write time rather than re-resolved on read.
 */
export interface ScopeChangeNotice {
  fromOrganizationName: string | null;
  fromGminaName: string | null;
  toOrganizationName: string | null;
  toGminaName: string | null;
  changedAt: string;
  // Index signature only so this satisfies Prisma's InputJsonObject when
  // written to User.pendingScopeChangeNotice — every field above is already
  // a plain string|null, this adds no real flexibility.
  [key: string]: string | null;
}

interface Assignment {
  gminaId: string | null;
  organizationId: string | null;
}

/** True when `before`/`after` name the same org+gmina pair — the only case with nothing to notify about. */
export function assignmentChanged(before: Assignment, after: Assignment): boolean {
  return before.gminaId !== after.gminaId || before.organizationId !== after.organizationId;
}

async function resolveNames(
  tx: Prisma.TransactionClient,
  assignment: Assignment
): Promise<{ gminaName: string | null; organizationName: string | null }> {
  const [gmina, organization] = await Promise.all([
    assignment.gminaId ? tx.gmina.findUnique({ where: { id: assignment.gminaId }, select: { name: true } }) : null,
    assignment.organizationId
      ? tx.organization.findUnique({ where: { id: assignment.organizationId }, select: { name: true } })
      : null,
  ]);
  return { gminaName: gmina?.name ?? null, organizationName: organization?.name ?? null };
}

/**
 * Builds the {from, to} display-name notice for a reassignment — call only
 * when assignmentChanged(before, after) is true. Resolves both ends inside
 * the SAME transaction as the write that's about to commit them, so the
 * names captured always match what's actually being written, not a stale
 * read from before it.
 */
export async function buildAssignmentNotice(
  tx: Prisma.TransactionClient,
  before: Assignment,
  after: Assignment
): Promise<ScopeChangeNotice> {
  const [fromNames, toNames] = await Promise.all([resolveNames(tx, before), resolveNames(tx, after)]);
  return {
    fromGminaName: fromNames.gminaName,
    fromOrganizationName: fromNames.organizationName,
    toGminaName: toNames.gminaName,
    toOrganizationName: toNames.organizationName,
    changedAt: new Date().toISOString(),
  };
}

/**
 * Best-effort real-time nudge so an open tab shows the modal immediately
 * instead of waiting for its next navigation/reload — the persisted
 * pendingScopeChangeNotice column (read via GET /api/user/scope-change-notice)
 * is the reliable delivery path this only speeds up; a dropped event just
 * means the user sees it on their next page load instead.
 */
export async function publishAssignmentNoticeEvent(userId: string): Promise<void> {
  await publishAdminEvent({ scope: 'user-notice', targetUserId: userId });
}
