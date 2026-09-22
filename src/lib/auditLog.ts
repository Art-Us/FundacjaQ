import { AuditAction, AuditEntityType, Prisma, type Gmina, type InviteToken, type Organization, type User } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isLastActiveAdmin, wouldLoseActiveAdminStatus } from '@/lib/authz';
import { requiresGmina } from '@/lib/gmina';
import { parseClientIp } from '@/lib/clientIp';
import { invalidateUserStatusCache } from '@/lib/userStatusCache';
import { publishAdminEvent, type AdminEventScope } from '@/lib/adminEvents';

// Which entity types have a live-updating admin page today — RESOURCE/
// ALERT_NEED/RESOURCE_ALLOCATION/ORGANIZATION audit entries still get
// written as usual, just without a matching page to push them to yet
// (see the SSE plan for alerts/resources/chat). Extending coverage later
// is exactly one new entry here — recordAudit and revertAuditLog both key
// off this single map, nothing else needs to change.
const ENTITY_TYPE_TO_ADMIN_SCOPE: Partial<Record<AuditEntityType, AdminEventScope>> = {
  USER: 'users',
  GMINA: 'gminas',
  INVITE_TOKEN: 'invites',
  ORGANIZATION: 'organizations',
};

/** Builds the {ipAddress, userAgent} pair recordAudit expects, from an incoming request. */
export function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: parseClientIp(req.headers.get('x-forwarded-for')),
    userAgent: req.headers.get('user-agent'),
  };
}

export interface AuditActor {
  id: string;
  // Optional/nullable because AuthorizedUser (lib/authz.ts) declares these as
  // such for backward compatibility with existing mocks — recordAudit falls
  // back to a placeholder so the (NOT NULL) actorEmail column always gets a value.
  email?: string | null;
  name?: string | null;
  role: string;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

interface RecordAuditInput {
  actor: AuditActor;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  gminaId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: RequestMeta;
  isRevert?: boolean;
  revertOfId?: string;
}

/**
 * Writes one append-only audit row. Never throws — the mutation this records
 * has already succeeded in the database by the time this runs, so a logging
 * failure must not turn a successful admin action into a 500. Callers should
 * still `await` it (not fire-and-forget) so ordering with the HTTP response
 * stays predictable in tests and logs.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actor.id,
        actorEmail: input.actor.email ?? 'nieznany@system',
        actorName: input.actor.name ?? null,
        actorRole: input.actor.role as never,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        gminaId: input.gminaId,
        before: input.before === undefined ? Prisma.JsonNull : (input.before as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
        after: input.after === undefined ? Prisma.JsonNull : (input.after as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
        ipAddress: input.meta?.ipAddress ?? null,
        userAgent: input.meta?.userAgent ?? null,
        isRevert: input.isRevert ?? false,
        revertOfId: input.revertOfId,
      },
    });
  } catch (err) {
    console.error('[auditLog] failed to record audit entry:', err);
    return; // nothing was actually written — no admin page needs to hear about it
  }

  const entityScope = ENTITY_TYPE_TO_ADMIN_SCOPE[input.entityType];
  if (entityScope) {
    await publishAdminEvent({ scope: 'logs', action: input.action });
    await publishAdminEvent({ scope: entityScope, action: input.action });
  }
}

// --- Snapshot allowlists -----------------------------------------------
// Each of these is the single place deciding what an audit row is allowed to
// remember about an entity. passwordHash and tokenHash must NEVER appear
// here — see the AuditLog model comment in schema.prisma.

// updatedAt is deliberately NOT captured here (or read anywhere in
// revertUser/revertGmina below) — it used to back the optimistic-concurrency
// check, but that's keyed on the actual admin-managed fields instead now
// (see the comment in revertUser: updatedAt is bumped by unrelated writes
// like login-lockout bookkeeping, making it the wrong token to key off).
// Keeping it in the snapshot would only add a meaningless "updatedAt
// changed" row to the diff table in the logs UI on literally every entry.
type UserSnapshotSource = Pick<
  User,
  | 'id'
  | 'name'
  | 'email'
  | 'role'
  | 'organizationId'
  | 'phone'
  | 'gminaId'
  | 'isActive'
  | 'lastActivatedAt'
  | 'lastDeactivatedAt'
  | 'deactivationReason'
>;

export function snapshotUser(user: UserSnapshotSource): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    phone: user.phone,
    gminaId: user.gminaId,
    isActive: user.isActive,
    lastActivatedAt: user.lastActivatedAt,
    lastDeactivatedAt: user.lastDeactivatedAt,
    deactivationReason: user.deactivationReason,
  };
}

type GminaSnapshotSource = Pick<Gmina, 'id' | 'name' | 'powiat' | 'voivodeship' | 'latitude' | 'longitude'>;

export function snapshotGmina(gmina: GminaSnapshotSource): Record<string, unknown> {
  return {
    id: gmina.id,
    name: gmina.name,
    powiat: gmina.powiat,
    voivodeship: gmina.voivodeship,
    latitude: gmina.latitude,
    longitude: gmina.longitude,
  };
}

type OrganizationSnapshotSource = Pick<
  Organization,
  | 'id'
  | 'name'
  | 'street'
  | 'houseNumber'
  | 'apartmentNumber'
  | 'city'
  | 'postalCode'
  | 'gminaId'
  | 'contactFirstName'
  | 'contactLastName'
  | 'contactPhone'
  | 'contactEmail'
>;

export function snapshotOrganization(organization: OrganizationSnapshotSource): Record<string, unknown> {
  return {
    id: organization.id,
    name: organization.name,
    street: organization.street,
    houseNumber: organization.houseNumber,
    apartmentNumber: organization.apartmentNumber,
    city: organization.city,
    postalCode: organization.postalCode,
    gminaId: organization.gminaId,
    contactFirstName: organization.contactFirstName,
    contactLastName: organization.contactLastName,
    contactPhone: organization.contactPhone,
    contactEmail: organization.contactEmail,
  };
}

export function snapshotInvite(invite: InviteToken): Record<string, unknown> {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    gminaId: invite.gminaId,
    organizationId: invite.organizationId,
    createdById: invite.createdById,
    expiresAt: invite.expiresAt,
    usedAt: invite.usedAt,
    revokedAt: invite.revokedAt,
  };
}

/**
 * Logs GMINA_CREATE when resolveGminaId() (lib/gmina.ts) just created a
 * brand-new gmina via the "+ Nowa gmina" inline flow — shared by every route
 * that resolves a gminaId/newGminaName pair (POST/PATCH /api/admin/users,
 * POST /api/admin/invites) so this stays one place to keep in sync instead
 * of three near-identical copies.
 */
export async function auditInlineGminaCreation(
  actor: AuditActor,
  resolved: { created: boolean; gmina: Gmina | null },
  meta?: RequestMeta
): Promise<void> {
  if (!resolved.created || !resolved.gmina) return;
  await recordAudit({
    actor,
    action: 'GMINA_CREATE',
    entityType: 'GMINA',
    entityId: resolved.gmina.id,
    gminaId: resolved.gmina.id,
    after: snapshotGmina(resolved.gmina),
    meta,
  });
}

// --- Action kinds ----------------------------------------------------------
// The logs list filters by a coarse "kind" instead of the exact per-entity
// action code — which entity it's about is already a separate filter
// (entityType), so a second dropdown that also spells out the entity (e.g.
// "Utworzenie użytkownika" vs "Utworzenie gminy") is redundant. USER_ACTIVATE
// and USER_DEACTIVATE fold into UPDATE here since, from a filtering
// standpoint, they're just another kind of user edit.

export const ACTION_KINDS = ['CREATE', 'UPDATE', 'DELETE', 'INVITE'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_KIND_MAP: Record<ActionKind, AuditAction[]> = {
  CREATE: ['USER_CREATE', 'GMINA_CREATE', 'ORGANIZATION_CREATE'],
  UPDATE: ['USER_UPDATE', 'GMINA_UPDATE', 'USER_ACTIVATE', 'USER_DEACTIVATE', 'USER_UNLOCK', 'ORGANIZATION_UPDATE'],
  DELETE: ['USER_DELETE', 'GMINA_DELETE', 'ORGANIZATION_DELETE'],
  INVITE: ['INVITE_CREATE', 'INVITE_REVOKE', 'INVITE_REACTIVATE'],
};

export const ACTION_KIND_LABELS: Record<ActionKind, string> = {
  CREATE: 'Dodanie',
  UPDATE: 'Edycja',
  DELETE: 'Usunięcie',
  INVITE: 'Zaproszenie',
};

// --- Revert --------------------------------------------------------------

/**
 * Actions that can be reverted. USER_CREATE and USER_DELETE are deliberately
 * excluded: snapshots never contain passwordHash, so "undoing" either one
 * would mean recreating or deleting a login-capable account without being
 * able to restore its real password — silently producing a broken account is
 * worse than not offering the button. Every other action only ever touches
 * fields that ARE captured in the snapshot, so those can be reverted safely.
 *
 * INVITE_REACTIVATE is excluded for the same reason as USER_CREATE/DELETE:
 * it mints a brand-new raw token that (like a password) is never stored, only
 * its hash — reverting couldn't restore the invite to a working state anyway,
 * it would just silently revoke a link that may already have been handed out.
 *
 * USER_UNLOCK is excluded because "reverting" it would mean re-locking the
 * account for whatever time was left on the original block — a block that,
 * by the time anyone would revert this, has almost certainly already
 * expired, making the revert a no-op at best and confusing at worst.
 */
const REVERTIBLE_ACTIONS = new Set<AuditAction>([
  'USER_UPDATE',
  'USER_ACTIVATE',
  'USER_DEACTIVATE',
  'GMINA_CREATE',
  'GMINA_UPDATE',
  'GMINA_DELETE',
  'ORGANIZATION_CREATE',
  'ORGANIZATION_UPDATE',
  'ORGANIZATION_DELETE',
  'INVITE_CREATE',
  'INVITE_REVOKE',
]);

/** Whether the UI/API should offer a revert for this row — used by both the logs list and the revert endpoint. */
export function canRevert(log: { action: AuditAction; revertedAt: Date | null }): boolean {
  return log.revertedAt === null && REVERTIBLE_ACTIONS.has(log.action);
}

// USER_UPDATE/GMINA_UPDATE/USER_ACTIVATE/USER_DEACTIVATE are pure field
// restores — "revert" always means the same thing (write back `before`)
// regardless of which direction it's undoing. GMINA_CREATE/DELETE and
// INVITE_CREATE/REVOKE are NOT: they're structural opposites, so reverting a
// *revert* of one of those means performing the OTHER operation, not
// literally repeating the same branch. E.g. a GMINA_CREATE row's revert
// deletes the gmina; if THAT revert record is itself later reverted, the
// intent is "un-delete" (recreate) — exactly what GMINA_DELETE's own revert
// branch does — not another attempt to delete an already-deleted gmina.
const OPPOSITE_ACTION: Partial<Record<AuditAction, AuditAction>> = {
  GMINA_CREATE: 'GMINA_DELETE',
  GMINA_DELETE: 'GMINA_CREATE',
  ORGANIZATION_CREATE: 'ORGANIZATION_DELETE',
  ORGANIZATION_DELETE: 'ORGANIZATION_CREATE',
  INVITE_CREATE: 'INVITE_REVOKE',
  INVITE_REVOKE: 'INVITE_CREATE',
};

/**
 * The action to actually dispatch a revert step on. Only differs from
 * `step.action` when `step.isRevert` is true AND that action has a
 * structural opposite (see OPPOSITE_ACTION) — without this, reverting a
 * revert of e.g. INVITE_CREATE would re-run INVITE_CREATE's own "revoke it"
 * branch on an invite that's already revoked, hit its "already withdrawn,
 * nothing to do" early return, and report a false success while leaving the
 * invite exactly as revoked as before.
 */
function effectiveAction(step: { action: AuditAction; isRevert: boolean }): AuditAction {
  if (step.isRevert) {
    return OPPOSITE_ACTION[step.action] ?? step.action;
  }
  return step.action;
}

type Failure = { ok: false; status: number; error: string };
/** Result of reverting a single log entry — used internally by the per-entity step functions. */
type StepResult = { ok: true } | Failure;
/** Result of the public revertAuditLog() call — may have cascaded through more than one log entry. */
export type RevertResult = { ok: true; revertedLogIds: string[] } | Failure;

function conflict(error: string): Failure {
  return { ok: false, status: 409, error };
}
function badRequest(error: string): Failure {
  return { ok: false, status: 400, error };
}
function notFound(error: string): Failure {
  return { ok: false, status: 404, error };
}

/** Thrown from inside the revert transaction to abort+rollback it while carrying a typed result back out. */
class RevertAbort extends Error {
  constructor(public readonly result: Failure) {
    super('revert-aborted');
  }
}

/**
 * Reverts the action recorded by `logId`. If that log is no longer the most
 * recent (still-active) one for its entity — e.g. reverting an old gmina
 * rename after a newer rename was applied on top of it — this cascades:
 * every later, not-yet-reverted log for that SAME (entityType, entityId) is
 * undone first, newest to oldest, ending with the requested one, so the
 * entity ends up exactly in the state it was in right before the requested
 * action. Only that one entity's own history is ever touched — an
 * interleaved change to a different record (e.g. a user edited in between
 * two gmina renames) lives under a different entityId and is never included.
 *
 * The whole cascade runs in one DB transaction: either every step applies or
 * none do. Each step's write is itself conditioned on the exact state it
 * expects (see revertUser/revertGmina/revertInvite) so a concurrent edit
 * from outside this chain — by another admin, mid-revert — is detected and
 * aborts the transaction instead of being silently overwritten.
 *
 * `restrictToGminaId`, when passed (by POST /api/admin/logs/[id]/revert for
 * a gmina-scoped admin), requires EVERY entry in the cascade chain — not
 * just the requested `logId` itself — to belong to that gmina. An entity's
 * history can span more than one gmina (e.g. a global admin later moved a
 * user from gmina A to gmina B); without this, a gmina-A admin targeting an
 * old, gmina-A-tagged entry could cascade through and revert a later,
 * gmina-B-tagged change too, reaching outside their own scope. The route
 * itself already checks the target entry up front, but that alone doesn't
 * cover the rest of the chain.
 */
export async function revertAuditLog(
  logId: string,
  actor: AuditActor,
  meta?: RequestMeta,
  restrictToGminaId?: string
): Promise<RevertResult> {
  try {
    const { revertedLogIds, revertedUserIds, revertedEntityTypes } = await prisma.$transaction(async (tx) => {
      const target = await tx.auditLog.findUnique({ where: { id: logId } });
      if (!target) throw new RevertAbort(notFound('Wpis dziennika nie istnieje.'));
      if (target.revertedAt) throw new RevertAbort(conflict('Ta zmiana została już cofnięta.'));
      if (!REVERTIBLE_ACTIONS.has(target.action)) {
        throw new RevertAbort(badRequest('Tego typu działania nie można cofnąć.'));
      }

      // Ordered by `seq` (a real DB-assigned monotonic counter), not
      // createdAt/id — two rows for the same entity can land in the same
      // millisecond, and cuids are only roughly time-ordered, not guaranteed
      // to be, so either could reconstruct the wrong causal order here.
      const chain = await tx.auditLog.findMany({
        where: {
          entityType: target.entityType,
          entityId: target.entityId,
          revertedAt: null,
          seq: { gte: target.seq },
        },
        orderBy: { seq: 'asc' },
      });

      if (restrictToGminaId !== undefined && chain.some((entry) => entry.gminaId !== restrictToGminaId)) {
        throw new RevertAbort(
          conflict(
            'Nie można cofnąć tej zmiany — historia tego wpisu obejmuje inną gminę niż Twoja.'
          )
        );
      }

      const blocker = chain.find((entry) => !REVERTIBLE_ACTIONS.has(entry.action));
      if (blocker) {
        throw new RevertAbort(
          badRequest(
            `Nie można cofnąć się aż tak daleko — działania ${blocker.action} z dnia ${blocker.createdAt.toISOString()} nie da się cofnąć.`
          )
        );
      }

      // Undo newest-first. Each step restores the entity to that step's own
      // `before` — which, by construction (every mutation is logged), is
      // exactly what the previous iteration's `after` was, so the very next
      // step's conditional write always matches unless something OUTSIDE
      // this chain touched the record in between. Applying the entity
      // mutation and its own bookkeeping (mark reverted + record the revert)
      // together, one step at a time, is equivalent to doing all mutations
      // first and all bookkeeping after — this is one transaction either
      // way, so a later step throwing rolls back everything regardless —
      // but avoids extracting/re-casting each step's before/after twice.
      const steps = [...chain].reverse();
      const now = new Date();

      for (const step of steps) {
        const before = (step.before ?? {}) as Record<string, unknown>;
        const after = (step.after ?? {}) as Record<string, unknown>;
        let stepResult: StepResult;
        switch (step.entityType) {
          case 'USER':
            stepResult = await revertUser(tx, step.entityId, before, after, actor);
            break;
          case 'GMINA':
            stepResult = await revertGmina(tx, effectiveAction(step), step.entityId, before, after);
            break;
          case 'ORGANIZATION':
            stepResult = await revertOrganization(tx, effectiveAction(step), step.entityId, before, after);
            break;
          case 'INVITE_TOKEN':
            stepResult = await revertInvite(tx, effectiveAction(step), step.entityId, before, after);
            break;
          default:
            stepResult = badRequest('Nieobsługiwany typ encji.');
        }
        if (!stepResult.ok) throw new RevertAbort(stepResult);

        await tx.auditLog.update({
          where: { id: step.id },
          data: { revertedAt: now, revertedById: actor.id },
        });

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            actorEmail: actor.email ?? 'nieznany@system',
            actorName: actor.name ?? null,
            actorRole: actor.role as never,
            action: step.action,
            entityType: step.entityType,
            entityId: step.entityId,
            gminaId: step.gminaId,
            before: (after as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
            after: (before as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
            ipAddress: meta?.ipAddress ?? null,
            userAgent: meta?.userAgent ?? null,
            isRevert: true,
            revertOfId: step.id,
          },
        });
      }

      return {
        revertedLogIds: steps.map((step) => step.id),
        revertedUserIds: steps.filter((step) => step.entityType === 'USER').map((step) => step.entityId),
        revertedEntityTypes: new Set(steps.map((step) => step.entityType)),
      };
    });

    // Best-effort, outside the transaction: a USER step's write already
    // committed above, so a cache left stale here only costs up to the
    // 2-minute TTL (lib/userStatusCache.ts), not a security hole.
    await Promise.all(revertedUserIds.map((id) => invalidateUserStatusCache(id)));

    // Same best-effort spirit as the cache invalidation above — a dropped
    // event just means an open admin page waits for its next own action or a
    // manual reload. 'logs' always fires (any revert is visible there,
    // whatever it touched); the entity-specific scope reuses the same map
    // recordAudit uses, so e.g. a GMINA revert notifies admin/gminas (and
    // admin/users' + admin/invites' gmina pickers) without a separate check.
    await publishAdminEvent({ scope: 'logs' });
    for (const entityType of Array.from(revertedEntityTypes)) {
      const scope = ENTITY_TYPE_TO_ADMIN_SCOPE[entityType];
      if (scope) await publishAdminEvent({ scope });
    }

    return { ok: true, revertedLogIds };
  } catch (err) {
    if (err instanceof RevertAbort) return err.result;
    console.error('[auditLog] revert transaction failed:', err);
    return { ok: false, status: 500, error: 'Nie udało się cofnąć zmiany.' };
  }
}

async function revertUser(
  tx: Prisma.TransactionClient,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actor: AuditActor
): Promise<StepResult> {
  const target = await tx.user.findUnique({ where: { id: entityId } });
  if (!target) return notFound('Użytkownik nie istnieje (mógł zostać usunięty).');

  const nextIsActive = (before.isActive as boolean | undefined) ?? target.isActive;
  const nextRole = (before.role as string | undefined) ?? target.role;
  const nextGminaId = before.gminaId !== undefined ? (before.gminaId as string | null) : target.gminaId;

  // Mirrors the same guards PATCH /api/admin/users/[id] and the
  // activate/deactivate routes enforce for the original mutation.
  if (target.id === actor.id && nextIsActive === false && target.isActive) {
    return { ok: false, status: 403, error: 'Nie możesz dezaktywować własnego konta.' };
  }
  if (
    wouldLoseActiveAdminStatus(target, { role: nextRole, isActive: nextIsActive }) &&
    (await isLastActiveAdmin(target, tx))
  ) {
    return { ok: false, status: 403, error: 'Nie można dezaktywować jedynego aktywnego administratora w systemie.' };
  }
  if (requiresGmina(nextRole as never) && !nextGminaId) {
    return badRequest('Ta rola wymaga przypisanej gminy.');
  }
  if (before.email && before.email !== target.email) {
    const existing = await tx.user.findUnique({ where: { email: before.email as string } });
    if (existing && existing.id !== target.id) {
      return badRequest('Konto dla tego adresu email już istnieje.');
    }
  }

  // Organization is itself gmina-scoped — restoring before.organizationId is
  // only safe if that organization's CURRENT gmina still matches the gmina
  // being restored onto the user. The organization may have been reassigned
  // to a different gmina (PATCH /api/admin/organizations/[id]) at any point
  // after this action was recorded but before it's reverted; the P2003 catch
  // below only catches the organization being deleted outright, not this.
  // Mirrors the equivalent gmina-match guard in revertOrganization.
  if (before.organizationId) {
    const organization = await tx.organization.findUnique({
      where: { id: before.organizationId as string },
      select: { gminaId: true },
    });
    if (organization && organization.gminaId !== nextGminaId) {
      return conflict(
        'Nie można przywrócić tej zmiany — organizacja przypisana w tym wpisie należy teraz do innej gminy.'
      );
    }
  }

  // The write itself is conditioned on the admin-managed fields still
  // matching what this step expects — one atomic UPDATE ... WHERE, not a
  // separate check-then-write, so a concurrent edit landing between our read
  // above and this statement can never be silently overwritten.
  //
  // Deliberately NOT conditioned on `updatedAt`: that column is bumped by
  // Prisma's @updatedAt on ANY write to the row, including ones with nothing
  // to do with admin-managed fields — lockout.ts's login-failure/reset
  // bookkeeping (failedAttempts/lockedUntil) and the password-reset flow
  // both call prisma.user.update() on this same row. A user who merely logs
  // in between the audited action and the revert attempt would otherwise
  // make every revert on their account spuriously "conflict" even though
  // none of the fields this revert actually touches had changed.
  const expectedFields: Prisma.UserWhereInput = {
    name: (after.name as string | null | undefined) ?? null,
    email: after.email as string | undefined,
    role: after.role as never,
    organizationId: (after.organizationId as string | null | undefined) ?? null,
    phone: (after.phone as string | null | undefined) ?? null,
    gminaId: (after.gminaId as string | null | undefined) ?? null,
    isActive: after.isActive as boolean | undefined,
    lastActivatedAt: after.lastActivatedAt ? new Date(after.lastActivatedAt as string) : null,
    lastDeactivatedAt: after.lastDeactivatedAt ? new Date(after.lastDeactivatedAt as string) : null,
    deactivationReason: (after.deactivationReason as string | null | undefined) ?? null,
  };

  try {
    const result = await tx.user.updateMany({
      where: { id: target.id, ...expectedFields },
      data: {
        name: (before.name as string | null) ?? null,
        email: before.email as string | undefined,
        role: nextRole as never,
        organizationId: (before.organizationId as string | null) ?? null,
        phone: (before.phone as string | null) ?? null,
        gminaId: nextGminaId,
        isActive: nextIsActive,
        lastActivatedAt: before.lastActivatedAt ? new Date(before.lastActivatedAt as string) : null,
        lastDeactivatedAt: before.lastDeactivatedAt ? new Date(before.lastDeactivatedAt as string) : null,
        deactivationReason: (before.deactivationReason as string | null) ?? null,
      },
    });
    if (result.count === 0) {
      return conflict('Stan użytkownika zmienił się od tego czasu — cofnięcie nie jest już bezpieczne.');
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return badRequest('Konto dla tego adresu email już istnieje.');
    }
    // organizationId is a real FK now (unlike the old free-text organization
    // column) — restoring it can fail if that organization was deleted since
    // this action was recorded.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return badRequest('Organizacja przypisana w tym wpisie już nie istnieje — nie można przywrócić.');
    }
    return { ok: false, status: 500, error: 'Nie udało się cofnąć zmiany.' };
  }

  return { ok: true };
}

async function revertGmina(
  tx: Prisma.TransactionClient,
  action: AuditAction,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<StepResult> {
  if (action === 'GMINA_CREATE') {
    try {
      // deleteMany (not delete) so "does it still exist" and "delete it" are
      // one atomic statement instead of a separate check-then-act.
      const result = await tx.gmina.deleteMany({ where: { id: entityId } });
      if (result.count === 0) return conflict('Gmina została już usunięta.');
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        return conflict(
          'Nie można cofnąć utworzenia tej gminy, ponieważ są z nią powiązani użytkownicy, zasoby, alerty, zaproszenia lub organizacje.'
        );
      }
      return { ok: false, status: 500, error: 'Nie udało się cofnąć zmiany.' };
    }
    return { ok: true };
  }

  if (action === 'GMINA_DELETE') {
    const existing = await tx.gmina.findUnique({ where: { id: entityId } });
    if (existing) return conflict('Gmina już istnieje — nie ma czego przywracać.');
    const nameCollision = await tx.gmina.findFirst({
      where: { name: { equals: before.name as string, mode: 'insensitive' } },
    });
    if (nameCollision) return badRequest('Gmina o tej nazwie już istnieje — nie można przywrócić.');
    try {
      await tx.gmina.create({
        data: {
          id: entityId,
          name: before.name as string,
          powiat: (before.powiat as string | null) ?? null,
          voivodeship: (before.voivodeship as string | null) ?? null,
          latitude: (before.latitude as number | null) ?? null,
          longitude: (before.longitude as number | null) ?? null,
        },
      });
    } catch (err) {
      // The findFirst check above is case-insensitive but Gmina.name's
      // unique index is case-sensitive — a concurrent create of a
      // differently-cased name (e.g. "Warszawa" vs "WARSZAWA") can race past
      // that check and only collide here. Same message as the pre-check,
      // not a generic 500, since this is the identical "already exists"
      // condition, just caught one statement later.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return badRequest('Gmina o tej nazwie już istnieje — nie można przywrócić.');
      }
      return { ok: false, status: 500, error: 'Nie udało się przywrócić gminy.' };
    }
    return { ok: true };
  }

  // GMINA_UPDATE
  const target = await tx.gmina.findUnique({ where: { id: entityId } });
  if (!target) return notFound('Gmina nie istnieje (mogła zostać usunięta).');
  if (before.name && (before.name as string).toLowerCase() !== target.name.toLowerCase()) {
    const nameCollision = await tx.gmina.findFirst({
      where: { name: { equals: before.name as string, mode: 'insensitive' } },
    });
    if (nameCollision && nameCollision.id !== target.id) {
      return badRequest('Gmina o tej nazwie już istnieje.');
    }
  }

  // Conditioned on the actual admin-managed fields (not `updatedAt` — see the
  // matching comment in revertUser for why that column is the wrong token to
  // key off): nothing currently writes to Gmina outside these admin routes,
  // but keying off the real fields costs nothing and avoids the same trap if
  // that ever changes.
  const expectedFields: Prisma.GminaWhereInput = {
    name: after.name as string | undefined,
    powiat: (after.powiat as string | null | undefined) ?? null,
    voivodeship: (after.voivodeship as string | null | undefined) ?? null,
    latitude: (after.latitude as number | null | undefined) ?? null,
    longitude: (after.longitude as number | null | undefined) ?? null,
  };

  try {
    const result = await tx.gmina.updateMany({
      where: { id: entityId, ...expectedFields },
      data: {
        name: before.name as string,
        powiat: (before.powiat as string | null) ?? null,
        voivodeship: (before.voivodeship as string | null) ?? null,
        latitude: (before.latitude as number | null) ?? null,
        longitude: (before.longitude as number | null) ?? null,
      },
    });
    if (result.count === 0) {
      return conflict('Stan gminy zmienił się od tego czasu — cofnięcie nie jest już bezpieczne.');
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return badRequest('Gmina o tej nazwie już istnieje.');
    }
    return { ok: false, status: 500, error: 'Nie udało się cofnąć zmiany.' };
  }
  return { ok: true };
}

async function revertOrganization(
  tx: Prisma.TransactionClient,
  action: AuditAction,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<StepResult> {
  if (action === 'ORGANIZATION_CREATE') {
    try {
      // deleteMany (not delete) so "does it still exist" and "delete it" are
      // one atomic statement instead of a separate check-then-act.
      const result = await tx.organization.deleteMany({ where: { id: entityId } });
      if (result.count === 0) return conflict('Organizacja została już usunięta.');
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        // Same as DELETE /api/admin/organizations/[id]'s own P2003 catch —
        // every relation pointing at Organization is RESTRICT now (users,
        // resources, allocations, invites, alerts), so this can't claim a
        // single specific cause without risking the same false diagnosis
        // that route was fixed for.
        return conflict(
          'Nie można cofnąć utworzenia tej organizacji, ponieważ istnieją powiązane rekordy (np. użytkownicy, zasoby, zaproszenia, alerty lub alokacje zasobów jako darczyńca).'
        );
      }
      return { ok: false, status: 500, error: 'Nie udało się cofnąć zmiany.' };
    }
    return { ok: true };
  }

  if (action === 'ORGANIZATION_DELETE') {
    const existing = await tx.organization.findUnique({ where: { id: entityId } });
    if (existing) return conflict('Organizacja już istnieje — nie ma czego przywracać.');
    const gminaId = before.gminaId as string;
    const nameCollision = await tx.organization.findFirst({
      where: { gminaId, name: { equals: before.name as string, mode: 'insensitive' } },
    });
    if (nameCollision) return badRequest('Organizacja o tej nazwie już istnieje w tej gminie — nie można przywrócić.');
    try {
      await tx.organization.create({
        data: {
          id: entityId,
          name: before.name as string,
          street: (before.street as string | null) ?? null,
          houseNumber: (before.houseNumber as string | null) ?? null,
          apartmentNumber: (before.apartmentNumber as string | null) ?? null,
          city: (before.city as string | null) ?? null,
          postalCode: (before.postalCode as string | null) ?? null,
          gminaId,
          contactFirstName: (before.contactFirstName as string | null) ?? null,
          contactLastName: (before.contactLastName as string | null) ?? null,
          contactPhone: (before.contactPhone as string | null) ?? null,
          contactEmail: (before.contactEmail as string | null) ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        return conflict('Nie można przywrócić organizacji — jej gmina już nie istnieje.');
      }
      // The findFirst check above is case-insensitive but the (name, gminaId)
      // unique index is case-sensitive — a concurrent create of a
      // differently-cased name in the same gmina can race past that check
      // and only collide here. Same message as the pre-check, not a generic
      // 500, since this is the identical "already exists" condition, just
      // caught one statement later.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return badRequest('Organizacja o tej nazwie już istnieje w tej gminie — nie można przywrócić.');
      }
      return { ok: false, status: 500, error: 'Nie udało się przywrócić organizacji.' };
    }
    return { ok: true };
  }

  // ORGANIZATION_UPDATE
  const target = await tx.organization.findUnique({ where: { id: entityId } });
  if (!target) return notFound('Organizacja nie istnieje (mogła zostać usunięta).');
  const beforeName = before.name as string | undefined;
  const beforeGminaId = (before.gminaId as string | undefined) ?? target.gminaId;
  if (
    beforeName &&
    (beforeName.toLowerCase() !== target.name.toLowerCase() || beforeGminaId !== target.gminaId)
  ) {
    const nameCollision = await tx.organization.findFirst({
      where: { gminaId: beforeGminaId, name: { equals: beforeName, mode: 'insensitive' } },
    });
    if (nameCollision && nameCollision.id !== target.id) {
      return badRequest('Organizacja o tej nazwie już istnieje w tej gminie.');
    }
  }

  // Same guard PATCH /api/admin/organizations/[id] applies when moving an
  // organization between gminas: every CURRENT user of this org has their
  // own gminaId set to the org's CURRENT gmina, so reverting a gmina change
  // here would silently strand them the same way a fresh reassignment would.
  if (beforeGminaId !== target.gminaId) {
    const usersCount = await tx.user.count({ where: { organizationId: target.id } });
    if (usersCount > 0) {
      return conflict(
        'Nie można cofnąć zmiany gminy tej organizacji, ponieważ są z nią powiązani użytkownicy przypisani do obecnej gminy.'
      );
    }
  }

  // Conditioned on the actual admin-managed fields, not `updatedAt` — same
  // reasoning as revertUser/revertGmina.
  const expectedFields: Prisma.OrganizationWhereInput = {
    name: after.name as string | undefined,
    street: (after.street as string | null | undefined) ?? null,
    houseNumber: (after.houseNumber as string | null | undefined) ?? null,
    apartmentNumber: (after.apartmentNumber as string | null | undefined) ?? null,
    city: (after.city as string | null | undefined) ?? null,
    postalCode: (after.postalCode as string | null | undefined) ?? null,
    gminaId: (after.gminaId as string | undefined) ?? target.gminaId,
    contactFirstName: (after.contactFirstName as string | null | undefined) ?? null,
    contactLastName: (after.contactLastName as string | null | undefined) ?? null,
    contactPhone: (after.contactPhone as string | null | undefined) ?? null,
    contactEmail: (after.contactEmail as string | null | undefined) ?? null,
  };

  try {
    const result = await tx.organization.updateMany({
      where: { id: entityId, ...expectedFields },
      data: {
        name: before.name as string,
        street: (before.street as string | null) ?? null,
        houseNumber: (before.houseNumber as string | null) ?? null,
        apartmentNumber: (before.apartmentNumber as string | null) ?? null,
        city: (before.city as string | null) ?? null,
        postalCode: (before.postalCode as string | null) ?? null,
        gminaId: beforeGminaId,
        contactFirstName: (before.contactFirstName as string | null) ?? null,
        contactLastName: (before.contactLastName as string | null) ?? null,
        contactPhone: (before.contactPhone as string | null) ?? null,
        contactEmail: (before.contactEmail as string | null) ?? null,
      },
    });
    if (result.count === 0) {
      return conflict('Stan organizacji zmienił się od tego czasu — cofnięcie nie jest już bezpieczne.');
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return badRequest('Organizacja o tej nazwie już istnieje w tej gminie.');
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return badRequest('Wybrana gmina nie istnieje.');
    }
    return { ok: false, status: 500, error: 'Nie udało się cofnąć zmiany.' };
  }
  return { ok: true };
}

async function revertInvite(
  tx: Prisma.TransactionClient,
  action: AuditAction,
  entityId: string,
  _before: Record<string, unknown>,
  _after: Record<string, unknown>
): Promise<StepResult> {
  const invite = await tx.inviteToken.findUnique({ where: { id: entityId } });
  if (!invite) return notFound('Zaproszenie nie istnieje.');

  if (action === 'INVITE_CREATE') {
    // Reverting a create means withdrawing it — the raw token was never
    // stored (only its hash), so it can only be revoked, never deleted and
    // reissued with the same link.
    if (invite.usedAt) return conflict('Zaproszenie zostało już wykorzystane — nie można go cofnąć.');
    if (invite.revokedAt) return { ok: true }; // already withdrawn, nothing to do
    const result = await tx.inviteToken.updateMany({
      where: { id: entityId, revokedAt: null, usedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      return conflict('Stan zaproszenia zmienił się od tego czasu — cofnięcie nie jest już bezpieczne.');
    }
    return { ok: true };
  }

  // INVITE_REVOKE → un-revoke
  if (!invite.revokedAt) return conflict('Zaproszenie nie jest unieważnione.');
  if (invite.usedAt) return conflict('Zaproszenie zostało już wykorzystane.');
  if (invite.expiresAt.getTime() < Date.now()) return conflict('Zaproszenie wygasło — nie można go przywrócić.');
  const result = await tx.inviteToken.updateMany({
    where: { id: entityId, revokedAt: invite.revokedAt },
    data: { revokedAt: null },
  });
  if (result.count === 0) {
    return conflict('Stan zaproszenia zmienił się od tego czasu — cofnięcie nie jest już bezpieczne.');
  }
  return { ok: true };
}
