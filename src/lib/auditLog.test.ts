import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient, User, Gmina, Organization, InviteToken } from '@prisma/client';

vi.mock('./prisma');
vi.mock('./authz', async () => {
  const actual = await vi.importActual<typeof import('./authz')>('./authz');
  return { ...actual, isLastActiveAdmin: vi.fn() };
});

import { prisma as prismaImport } from './prisma';
// Imported by its real path (not the mocked './prisma' specifier) purely so
// TypeScript can see it — vi.mock('./prisma') resolves both to the same
// on-disk module at runtime, so this is the identical instance either way.
import { installTransactionMock } from './__mocks__/prisma';
import { isLastActiveAdmin } from './authz';
import {
  recordAudit,
  requestMeta,
  auditInlineGminaCreation,
  snapshotUser,
  snapshotGmina,
  snapshotOrganization,
  snapshotInvite,
  canRevert,
  revertAuditLog,
  type AuditActor,
} from './auditLog';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const ACTOR: AuditActor = { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' };

function fullUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Jan',
    email: 'jan@example.com',
    passwordHash: 'super-secret-hash',
    role: 'VOLUNTEER',
    organizationId: null,
    phone: null,
    gminaId: 'gmina-1',
    emailVerified: null,
    isActive: true,
    lastActivatedAt: null,
    lastDeactivatedAt: null,
    deactivationReason: null,
    failedAttempts: 0,
    lockedUntil: null,
    passwordChangedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as User;
}

function fullGmina(overrides: Partial<Gmina> = {}): Gmina {
  return {
    id: 'gmina-1',
    name: 'Warszawa',
    powiat: null,
    voivodeship: null,
    latitude: null,
    longitude: null,
    contactEmail: null,
    contactPhone: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Gmina;
}

function fullOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'Caritas',
    street: null,
    houseNumber: null,
    apartmentNumber: null,
    city: null,
    postalCode: null,
    gminaId: 'gmina-1',
    contactFirstName: null,
    contactLastName: null,
    contactPhone: null,
    contactEmail: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Organization;
}

function fullInvite(overrides: Partial<InviteToken> = {}): InviteToken {
  return {
    id: 'invite-1',
    email: 'invitee@example.com',
    role: 'VOLUNTEER',
    gminaId: 'gmina-1',
    tokenHash: 'super-secret-token-hash',
    createdById: 'admin-1',
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    usedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as InviteToken;
}

function baseLog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'log-1',
    actorId: 'admin-1',
    actorEmail: 'admin@example.com',
    actorName: 'Admin',
    actorRole: 'ADMIN',
    action: 'USER_UPDATE',
    entityType: 'USER',
    entityId: 'user-1',
    gminaId: 'gmina-1',
    before: null,
    after: null,
    ipAddress: null,
    userAgent: null,
    isRevert: false,
    revertOfId: null,
    revertedById: null,
    revertedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Mocks the chain-discovery query (tx.auditLog.findMany) to return exactly these logs, as the DB would return them: ascending by createdAt. */
function mockChain(logs: Array<Record<string, unknown>>) {
  prisma.auditLog.findMany.mockResolvedValue(logs as any);
}

beforeEach(() => {
  mockReset(prisma);
  // mockReset wipes the $transaction implementation the shared mock installs
  // at module load — revertAuditLog runs its whole cascade through
  // prisma.$transaction(async (tx) => ...), so it must be reinstalled here.
  installTransactionMock(prisma);
  vi.mocked(isLastActiveAdmin).mockReset();
  vi.mocked(isLastActiveAdmin).mockResolvedValue(false);
});

describe('snapshot*', () => {
  it('snapshotUser never includes passwordHash', () => {
    const snap = snapshotUser(fullUser());
    expect(snap).not.toHaveProperty('passwordHash');
    expect(snap.email).toBe('jan@example.com');
  });

  it('snapshotGmina captures the editable fields', () => {
    const snap = snapshotGmina(fullGmina({ name: 'Kraków' }));
    expect(snap.name).toBe('Kraków');
  });

  it('snapshotOrganization captures the editable fields, including its gmina and contact person', () => {
    const snap = snapshotOrganization(fullOrganization({ name: 'PCK', contactFirstName: 'Jan' }));
    expect(snap.name).toBe('PCK');
    expect(snap.gminaId).toBe('gmina-1');
    expect(snap.contactFirstName).toBe('Jan');
  });

  it('snapshotInvite never includes tokenHash', () => {
    const snap = snapshotInvite(fullInvite());
    expect(snap).not.toHaveProperty('tokenHash');
    expect(snap.email).toBe('invitee@example.com');
  });

  // updatedAt used to back the (since-removed) updatedAt-keyed concurrency
  // check; keeping it in the snapshot after that check moved to the real
  // admin-managed fields would only add a meaningless "updatedAt changed"
  // row to the diff table in the logs UI on literally every single entry.
  it('snapshotUser/snapshotGmina no longer carry updatedAt', () => {
    expect(snapshotUser(fullUser())).not.toHaveProperty('updatedAt');
    expect(snapshotGmina(fullGmina())).not.toHaveProperty('updatedAt');
  });
});

describe('recordAudit', () => {
  it('writes a row with actor/action/entity and defaults missing before/after to JsonNull', async () => {
    prisma.auditLog.create.mockResolvedValue({} as any);

    await recordAudit({
      actor: ACTOR,
      action: 'USER_CREATE',
      entityType: 'USER',
      entityId: 'user-1',
      gminaId: 'gmina-1',
      after: { email: 'jan@example.com' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'admin-1',
          actorEmail: 'admin@example.com',
          action: 'USER_CREATE',
          entityType: 'USER',
          entityId: 'user-1',
          after: { email: 'jan@example.com' },
        }),
      })
    );
  });

  it('falls back to a placeholder actorEmail when the actor has none (e.g. an under-typed test mock)', async () => {
    prisma.auditLog.create.mockResolvedValue({} as any);

    await recordAudit({
      actor: { id: 'admin-1', role: 'ADMIN' },
      action: 'USER_CREATE',
      entityType: 'USER',
      entityId: 'user-1',
      gminaId: null,
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorEmail: expect.any(String) }) })
    );
  });

  it('swallows a DB failure instead of throwing, since the mutation it records already succeeded', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('connection lost'));

    await expect(
      recordAudit({ actor: ACTOR, action: 'USER_CREATE', entityType: 'USER', entityId: 'user-1', gminaId: null })
    ).resolves.toBeUndefined();
  });
});

describe('requestMeta', () => {
  it('extracts ipAddress (via parseClientIp, taking the last hop) and userAgent from request headers', () => {
    const req = new Request('http://localhost/api/whatever', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'user-agent': 'TestAgent/1.0' },
    });

    expect(requestMeta(req)).toEqual({ ipAddress: '10.0.0.1', userAgent: 'TestAgent/1.0' });
  });

  it('falls back to parseClientIp\'s "unknown" and a null userAgent when the headers are absent', () => {
    const req = new Request('http://localhost/api/whatever');

    expect(requestMeta(req)).toEqual({ ipAddress: 'unknown', userAgent: null });
  });
});

describe('auditInlineGminaCreation', () => {
  it('records a GMINA_CREATE entry when resolveGminaId() just created a brand-new gmina', async () => {
    prisma.auditLog.create.mockResolvedValue({} as any);
    const gmina = fullGmina({ id: 'gmina-new', name: 'Nowa Gmina' });

    await auditInlineGminaCreation(ACTOR, { created: true, gmina }, { ipAddress: '1.2.3.4', userAgent: 'UA' });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'GMINA_CREATE',
          entityType: 'GMINA',
          entityId: 'gmina-new',
          gminaId: 'gmina-new',
          after: snapshotGmina(gmina),
          ipAddress: '1.2.3.4',
          userAgent: 'UA',
        }),
      })
    );
  });

  it('is a no-op when an existing gmina was reused instead of created (resolved.created is false)', async () => {
    await auditInlineGminaCreation(ACTOR, { created: false, gmina: fullGmina() });

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('is a no-op when resolved.created is true but resolved.gmina is missing', async () => {
    await auditInlineGminaCreation(ACTOR, { created: true, gmina: null });

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('canRevert', () => {
  it('is false once a row is already reverted', () => {
    expect(canRevert({ action: 'USER_UPDATE', revertedAt: new Date() })).toBe(false);
  });

  it('is false for USER_CREATE/USER_DELETE (no passwordHash in the snapshot to restore)', () => {
    expect(canRevert({ action: 'USER_CREATE', revertedAt: null })).toBe(false);
    expect(canRevert({ action: 'USER_DELETE', revertedAt: null })).toBe(false);
  });

  it('is true for an un-reverted revertible action', () => {
    expect(canRevert({ action: 'USER_UPDATE', revertedAt: null })).toBe(true);
  });
});

describe('revertAuditLog — dispatch guards', () => {
  it('returns 404 when the log entry does not exist', async () => {
    prisma.auditLog.findUnique.mockResolvedValue(null);
    const result = await revertAuditLog('missing', ACTOR);
    expect(result).toEqual({ ok: false, status: 404, error: expect.any(String) });
  });

  it('returns 409 when the entry was already reverted', async () => {
    prisma.auditLog.findUnique.mockResolvedValue(baseLog({ revertedAt: new Date() }) as any);
    const result = await revertAuditLog('log-1', ACTOR);
    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });

  it('returns 400 for a non-revertible action (USER_CREATE)', async () => {
    prisma.auditLog.findUnique.mockResolvedValue(baseLog({ action: 'USER_CREATE' }) as any);
    const result = await revertAuditLog('log-1', ACTOR);
    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  // Regression coverage for the dispatcher's own switch(step.entityType): an
  // entityType the switch has no case for (RESOURCE/ALERT_NEED/etc. exist in
  // the AuditEntityType enum but have no revert branch here) must fall
  // through to the safe "Nieobsługiwany typ encji." rejection instead of
  // silently no-op'ing or throwing an unhandled error out of the transaction.
  it('rejects with the "unsupported entity type" fallback for an entityType the switch has no case for', async () => {
    const log = baseLog({ action: 'USER_UPDATE', entityType: 'RESOURCE', entityId: 'resource-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('revertAuditLog — USER (single step)', () => {
  const targetUpdatedAt = new Date('2026-02-01T00:00:00Z');

  it('reverts a USER_UPDATE back to the before snapshot via a conditional write keyed on the admin-managed fields', async () => {
    const before = { name: 'Old Name', email: 'jan@example.com', role: 'VOLUNTEER', gminaId: 'gmina-1', isActive: true };
    // A full snapshotUser()-shaped "after" — this is what the write's WHERE
    // gets conditioned on, deliberately NOT updatedAt (see the regression
    // test below for why).
    const after = {
      name: 'New Name',
      email: 'jan@example.com',
      role: 'VOLUNTEER',
      organizationId: null,
      phone: null,
      gminaId: 'gmina-1',
      isActive: true,
      lastActivatedAt: null,
      lastDeactivatedAt: null,
      deactivationReason: null,
      updatedAt: targetUpdatedAt.toISOString(),
    };
    const log = baseLog({ before, after });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser({ name: 'New Name', updatedAt: targetUpdatedAt }) as any);
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        name: 'New Name',
        email: 'jan@example.com',
        role: 'VOLUNTEER',
        organizationId: null,
        phone: null,
        gminaId: 'gmina-1',
        isActive: true,
        lastActivatedAt: null,
        lastDeactivatedAt: null,
        deactivationReason: null,
      },
      data: expect.objectContaining({ name: 'Old Name' }),
    });
    expect(prisma.auditLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'log-1' }, data: expect.objectContaining({ revertedById: 'admin-1' }) })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isRevert: true, revertOfId: 'log-1' }) })
    );
  });

  // Regression test for the exact bug reported in chat: reverting a user who
  // had merely logged in (or failed a login attempt) since the audited
  // action used to fail with a false "state changed" conflict, because
  // lockout.ts's failedAttempts/lockedUntil bookkeeping bumps the SAME
  // updatedAt column via Prisma's @updatedAt, unrelated to any admin field.
  it('does not conflict when only updatedAt moved (e.g. an unrelated login) but every admin-managed field still matches', async () => {
    const after = {
      name: 'Jan',
      email: 'jan@example.com',
      role: 'VOLUNTEER',
      organizationId: null,
      phone: null,
      gminaId: 'gmina-1',
      isActive: true,
      lastActivatedAt: null,
      lastDeactivatedAt: null,
      deactivationReason: null,
      updatedAt: targetUpdatedAt.toISOString(),
    };
    const log = baseLog({ before: { name: 'Old Name' }, after });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    // Current row: same admin-managed fields as `after`, but updatedAt has
    // since moved on (simulating an unrelated prisma.user.update() elsewhere).
    prisma.user.findUnique.mockResolvedValue(
      fullUser({ name: 'Jan', updatedAt: new Date('2026-05-01T00:00:00Z') }) as any
    );
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ updatedAt: expect.anything() }) })
    );
  });

  it('blocks the revert when the user changed again since — the conditional write matches 0 rows', async () => {
    const after = { updatedAt: targetUpdatedAt.toISOString() };
    const log = baseLog({ after });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser() as any);
    // Simulates a concurrent edit: the DB's WHERE (id + updatedAt) matches no rows.
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
    expect(prisma.user.updateMany).toHaveBeenCalled();
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to let an ADMIN self-deactivate themselves via a revert', async () => {
    const before = { isActive: false };
    const log = baseLog({ action: 'USER_ACTIVATE', entityId: 'admin-1', before, after: {} });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser({ id: 'admin-1', role: 'ADMIN', isActive: true }) as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 403, error: expect.any(String) });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('blocks reverting an activation when it would deactivate the last active admin', async () => {
    const before = { isActive: false, role: 'ADMIN' };
    const log = baseLog({ action: 'USER_ACTIVATE', before, after: {} });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser({ role: 'ADMIN', isActive: true }) as any);
    vi.mocked(isLastActiveAdmin).mockResolvedValue(true);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 403, error: expect.any(String) });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    // Reads the count through the same transaction client the revert itself
    // writes through (see the authz.ts doc comment) — not a fresh connection.
    expect(isLastActiveAdmin).toHaveBeenCalledWith(expect.anything(), prisma);
  });

  // Regression coverage: the last-admin guard used to only fire when
  // isActive was ending up false — reverting a log that changes `role` away
  // from ADMIN (leaving isActive untouched) has the same effect on the
  // active-admin count and went completely unchecked.
  it('blocks reverting a role change that would demote the last active admin', async () => {
    const before = { role: 'VOLUNTEER' };
    const log = baseLog({ before, after: { role: 'ADMIN' } });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser({ role: 'ADMIN', isActive: true }) as any);
    vi.mocked(isLastActiveAdmin).mockResolvedValue(true);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 403, error: expect.any(String) });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  // Regression coverage: restoring before.organizationId from the snapshot
  // used to trust the snapshot's gmina blindly — if the organization was
  // reassigned to a different gmina after this action was recorded but
  // before it's reverted, the user would end up in an organization that
  // belongs to someone else's gmina.
  it("blocks restoring a user's organization when that organization has since moved to a different gmina", async () => {
    const before = { organizationId: 'org-1', gminaId: 'gmina-old' };
    const log = baseLog({ before, after: {} });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser({ gminaId: 'gmina-old' }) as any);
    prisma.organization.findUnique.mockResolvedValue(fullOrganization({ gminaId: 'gmina-new' }) as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('allows restoring a user\'s organization when it still belongs to the restored gmina', async () => {
    const before = { organizationId: 'org-1', gminaId: 'gmina-1' };
    const log = baseLog({ before, after: { organizationId: null, gminaId: 'gmina-1' } });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser({ gminaId: 'gmina-1', organizationId: null }) as any);
    prisma.organization.findUnique.mockResolvedValue(fullOrganization({ gminaId: 'gmina-1' }) as any);
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
  });

  it('rejects the revert when the restored email now belongs to someone else', async () => {
    const before = { email: 'taken@example.com' };
    const log = baseLog({ before, after: {} });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique
      .mockResolvedValueOnce(fullUser({ email: 'current@example.com' }) as any)
      .mockResolvedValueOnce({ id: 'someone-else' } as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  // Regression coverage: organizationId is a real FK now (unlike the old
  // free-text organization column) — restoring a since-deleted organization
  // must report a clear, specific error, not fall through to a generic 500.
  it('reports a clear error (not a generic 500) when the organization to restore no longer exists', async () => {
    const { Prisma } = await import('@prisma/client');
    const before = { organizationId: 'deleted-org' };
    const log = baseLog({ before, after: {} });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser() as any);
    prisma.user.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: '5.19.1',
      })
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
  });

  // Regression coverage: the earlier test above ("rejects the revert when the
  // restored email now belongs to someone else") only covers the PRE-CHECK
  // read finding a conflict. This covers the RACE: the pre-check finds no
  // conflict (nobody held that email yet), but a colliding account is created
  // concurrently between that check and the conditional update itself, so the
  // update's own unique constraint is what actually catches it — mirrors the
  // identical race pattern already covered for revertGmina/revertOrganization
  // ("...races past the pre-check").
  it('reports "already exists" (not a generic 500) when a colliding email is created concurrently, racing past the pre-check', async () => {
    const { Prisma } = await import('@prisma/client');
    const before = { email: 'restored@example.com' };
    const log = baseLog({ before, after: {} });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique
      .mockResolvedValueOnce(fullUser({ email: 'current@example.com' }) as any) // target
      .mockResolvedValueOnce(null); // pre-check: no conflict yet
    prisma.user.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.19.1' })
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  // Regression coverage: mirrors the same "role requires a gmina" guard
  // PATCH /api/admin/users/[id] enforces on the original mutation — reverting
  // a role change BACK to a gmina-requiring role (e.g. COORDINATOR) must be
  // blocked, not silently applied, when the gminaId that would land alongside
  // it is missing.
  it('blocks reverting a role change back to a gmina-requiring role when the resulting gminaId would be missing', async () => {
    const before = { role: 'COORDINATOR', gminaId: null };
    const log = baseLog({ before, after: { role: 'ADMIN' } });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.user.findUnique.mockResolvedValue(fullUser({ role: 'ADMIN', gminaId: null }) as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('revertAuditLog — GMINA (single step)', () => {
  it('reverts a GMINA_CREATE by deleting the gmina (delete + existence check as one atomic deleteMany)', async () => {
    const log = baseLog({ action: 'GMINA_CREATE', entityType: 'GMINA', entityId: 'gmina-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.gmina.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.gmina.deleteMany).toHaveBeenCalledWith({ where: { id: 'gmina-1' } });
  });

  it('reports a conflict when the gmina was already deleted by something else since', async () => {
    const log = baseLog({ action: 'GMINA_CREATE', entityType: 'GMINA', entityId: 'gmina-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.gmina.deleteMany.mockResolvedValue({ count: 0 });

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });

  it('reports a conflict when the created gmina already has dependents (P2003)', async () => {
    const { Prisma } = await import('@prisma/client');
    const log = baseLog({ action: 'GMINA_CREATE', entityType: 'GMINA', entityId: 'gmina-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.gmina.deleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK', { code: 'P2003', clientVersion: '5.19.1' })
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });

  it('reverts a GMINA_DELETE by recreating it from the snapshot', async () => {
    const before = { name: 'Warszawa', powiat: null, voivodeship: null, latitude: null, longitude: null };
    const log = baseLog({ action: 'GMINA_DELETE', entityType: 'GMINA', entityId: 'gmina-1', before });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.gmina.findUnique.mockResolvedValue(null);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({} as any);
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.gmina.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 'gmina-1', name: 'Warszawa' }) })
    );
  });

  it('refuses to restore a deleted gmina whose name was taken by a new one since', async () => {
    const before = { name: 'Warszawa' };
    const log = baseLog({ action: 'GMINA_DELETE', entityType: 'GMINA', entityId: 'gmina-1', before });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.gmina.findUnique.mockResolvedValue(null);
    prisma.gmina.findFirst.mockResolvedValue(fullGmina({ id: 'gmina-2' }) as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  // Regression coverage: the pre-check above is case-insensitive but
  // Gmina.name's unique index is case-sensitive, so a concurrent create of a
  // differently-cased name can race past that check and only collide at the
  // DB level — this must surface the same "already exists" message, not a
  // generic 500.
  it('reports "already exists" (not a generic 500) when a differently-cased name races past the pre-check', async () => {
    const { Prisma } = await import('@prisma/client');
    const before = { name: 'Warszawa' };
    const log = baseLog({ action: 'GMINA_DELETE', entityType: 'GMINA', entityId: 'gmina-1', before });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.gmina.findUnique.mockResolvedValue(null);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.19.1' })
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
  });

  it('reverts a GMINA_UPDATE back to the before snapshot via a conditional write keyed on the admin-managed fields', async () => {
    const updatedAt = new Date('2026-02-01T00:00:00Z');
    const before = { name: 'Stara Nazwa', powiat: null, voivodeship: null, latitude: null, longitude: null };
    const after = {
      name: 'Nowa Nazwa',
      powiat: null,
      voivodeship: null,
      latitude: null,
      longitude: null,
      updatedAt: updatedAt.toISOString(),
    };
    const log = baseLog({ action: 'GMINA_UPDATE', entityType: 'GMINA', entityId: 'gmina-1', before, after });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.gmina.findUnique.mockResolvedValue(fullGmina({ name: 'Nowa Nazwa', updatedAt }) as any);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.gmina.updateMany).toHaveBeenCalledWith({
      where: { id: 'gmina-1', name: 'Nowa Nazwa', powiat: null, voivodeship: null, latitude: null, longitude: null },
      data: expect.objectContaining({ name: 'Stara Nazwa' }),
    });
  });

  it('blocks a GMINA_UPDATE revert when the gmina changed again since — the conditional write matches 0 rows', async () => {
    const updatedAt = new Date('2026-02-01T00:00:00Z');
    const after = { updatedAt: updatedAt.toISOString() };
    const log = baseLog({ action: 'GMINA_UPDATE', entityType: 'GMINA', entityId: 'gmina-1', after });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.gmina.findUnique.mockResolvedValue(fullGmina() as any);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.updateMany.mockResolvedValue({ count: 0 });

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
  });
});

describe('revertAuditLog — ORGANIZATION (single step)', () => {
  it('reverts an ORGANIZATION_CREATE by deleting the organization (delete + existence check as one atomic deleteMany)', async () => {
    const log = baseLog({ action: 'ORGANIZATION_CREATE', entityType: 'ORGANIZATION', entityId: 'org-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.organization.deleteMany).toHaveBeenCalledWith({ where: { id: 'org-1' } });
  });

  it('reports a conflict when the organization was already deleted by something else since', async () => {
    const log = baseLog({ action: 'ORGANIZATION_CREATE', entityType: 'ORGANIZATION', entityId: 'org-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.deleteMany.mockResolvedValue({ count: 0 });

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });

  it('reports a conflict when the created organization already has users assigned (P2003)', async () => {
    const { Prisma } = await import('@prisma/client');
    const log = baseLog({ action: 'ORGANIZATION_CREATE', entityType: 'ORGANIZATION', entityId: 'org-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.deleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK', { code: 'P2003', clientVersion: '5.19.1' })
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });

  it('reverts an ORGANIZATION_DELETE by recreating it from the snapshot', async () => {
    const before = {
      name: 'Caritas',
      street: null,
      houseNumber: null,
      apartmentNumber: null,
      city: null,
      postalCode: null,
      gminaId: 'gmina-1',
      contactFirstName: null,
      contactLastName: null,
      contactPhone: null,
      contactEmail: null,
    };
    const log = baseLog({ action: 'ORGANIZATION_DELETE', entityType: 'ORGANIZATION', entityId: 'org-1', before });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({} as any);
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 'org-1', name: 'Caritas', gminaId: 'gmina-1' }) })
    );
  });

  // Regression coverage: if the organization's own gmina was itself deleted
  // after the organization was (now possible, since deleting the org already
  // clears the only RESTRICT dependent that would otherwise block it),
  // recreating the organization must report a clear error, not an opaque 500.
  it('reports a clear error (not a generic 500) when restoring an organization whose gmina no longer exists', async () => {
    const { Prisma } = await import('@prisma/client');
    const before = { name: 'Caritas', gminaId: 'deleted-gmina' };
    const log = baseLog({ action: 'ORGANIZATION_DELETE', entityType: 'ORGANIZATION', entityId: 'org-1', before });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK', { code: 'P2003', clientVersion: '5.19.1' })
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });

  // Strengthens the test above with the exact Polish message the audit
  // expects for this branch, and confirms the failure is clean — no partial
  // bookkeeping (auditLog.update/create) escapes the aborted transaction.
  it('reports the specific "gmina no longer exists" message when recreating races into a P2003', async () => {
    const { Prisma } = await import('@prisma/client');
    const before = { name: 'Caritas', gminaId: 'deleted-gmina' };
    const log = baseLog({ action: 'ORGANIZATION_DELETE', entityType: 'ORGANIZATION', entityId: 'org-1', before });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: '5.19.1' })
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Nie można przywrócić organizacji — jej gmina już nie istnieje.',
    });
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to restore a deleted organization whose (name, gmina) was taken by a new one since', async () => {
    const before = { name: 'Caritas', gminaId: 'gmina-1' };
    const log = baseLog({ action: 'ORGANIZATION_DELETE', entityType: 'ORGANIZATION', entityId: 'org-1', before });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.organization.findFirst.mockResolvedValue(fullOrganization({ id: 'org-2' }) as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  // Regression coverage: the pre-check above is case-insensitive but the
  // (name, gminaId) unique index is case-sensitive, so a concurrent create
  // of a differently-cased name in the same gmina can race past that check
  // and only collide at the DB level — this must surface the same "already
  // exists" message, not a generic 500.
  it('reports "already exists" (not a generic 500) when a differently-cased name races past the pre-check', async () => {
    const { Prisma } = await import('@prisma/client');
    const before = { name: 'Caritas', gminaId: 'gmina-1' };
    const log = baseLog({ action: 'ORGANIZATION_DELETE', entityType: 'ORGANIZATION', entityId: 'org-1', before });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.19.1' })
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
  });

  it('reverts an ORGANIZATION_UPDATE back to the before snapshot via a conditional write keyed on the admin-managed fields', async () => {
    const before = {
      name: 'Stara Nazwa',
      street: null,
      houseNumber: null,
      apartmentNumber: null,
      city: null,
      postalCode: null,
      gminaId: 'gmina-1',
      contactFirstName: null,
      contactLastName: null,
      contactPhone: null,
      contactEmail: null,
    };
    const after = { ...before, name: 'Nowa Nazwa' };
    const log = baseLog({ action: 'ORGANIZATION_UPDATE', entityType: 'ORGANIZATION', entityId: 'org-1', before, after });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.findUnique.mockResolvedValue(fullOrganization({ name: 'Nowa Nazwa' }) as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.organization.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-1', ...after },
      data: expect.objectContaining({ name: 'Stara Nazwa' }),
    });
  });

  it('blocks an ORGANIZATION_UPDATE revert when the organization changed again since — the conditional write matches 0 rows', async () => {
    const after = { name: 'Nowa Nazwa', gminaId: 'gmina-1' };
    const log = baseLog({ action: 'ORGANIZATION_UPDATE', entityType: 'ORGANIZATION', entityId: 'org-1', after });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.findUnique.mockResolvedValue(fullOrganization() as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.updateMany.mockResolvedValue({ count: 0 });

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
  });

  // Regression coverage: mirrors the same guard PATCH
  // /api/admin/organizations/[id] applies — every CURRENT user of this org
  // has their own gminaId set to the org's CURRENT gmina, so reverting a
  // gmina change here must not silently strand them either.
  it('blocks reverting an ORGANIZATION_UPDATE gmina change when the organization still has users assigned', async () => {
    const before = { name: 'Caritas', gminaId: 'gmina-old' };
    const after = { name: 'Caritas', gminaId: 'gmina-new' };
    const log = baseLog({ action: 'ORGANIZATION_UPDATE', entityType: 'ORGANIZATION', entityId: 'org-1', before, after });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.organization.findUnique.mockResolvedValue(fullOrganization({ gminaId: 'gmina-new' }) as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(1);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
    expect(prisma.organization.updateMany).not.toHaveBeenCalled();
  });
});

describe('revertAuditLog — INVITE_TOKEN (single step)', () => {
  it('reverts an INVITE_CREATE by revoking the invite via a conditional write', async () => {
    const log = baseLog({ action: 'INVITE_CREATE', entityType: 'INVITE_TOKEN', entityId: 'invite-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.inviteToken.findUnique.mockResolvedValue(fullInvite() as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.inviteToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-1', revokedAt: null, usedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('blocks an INVITE_CREATE revert when the invite state changed again since', async () => {
    const log = baseLog({ action: 'INVITE_CREATE', entityType: 'INVITE_TOKEN', entityId: 'invite-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.inviteToken.findUnique.mockResolvedValue(fullInvite() as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });

  it('refuses to revert an INVITE_CREATE once the invite has been used', async () => {
    const log = baseLog({ action: 'INVITE_CREATE', entityType: 'INVITE_TOKEN', entityId: 'invite-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.inviteToken.findUnique.mockResolvedValue(fullInvite({ usedAt: new Date() }) as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
  });

  it('reverts an INVITE_REVOKE by un-revoking the invite via a conditional write', async () => {
    const revokedAt = new Date('2026-03-01T00:00:00Z');
    const log = baseLog({ action: 'INVITE_REVOKE', entityType: 'INVITE_TOKEN', entityId: 'invite-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.inviteToken.findUnique.mockResolvedValue(fullInvite({ revokedAt }) as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.inviteToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-1', revokedAt },
      data: { revokedAt: null },
    });
  });

  it('blocks an INVITE_REVOKE revert when the invite state changed again since', async () => {
    const log = baseLog({ action: 'INVITE_REVOKE', entityType: 'INVITE_TOKEN', entityId: 'invite-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.inviteToken.findUnique.mockResolvedValue(fullInvite({ revokedAt: new Date() }) as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
  });

  it('refuses to un-revoke an invite that has since expired', async () => {
    const log = baseLog({ action: 'INVITE_REVOKE', entityType: 'INVITE_TOKEN', entityId: 'invite-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.inviteToken.findUnique.mockResolvedValue(
      fullInvite({ revokedAt: new Date(), expiresAt: new Date('2020-01-01T00:00:00Z') }) as any
    );

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op (still ok) reverting an INVITE_CREATE that was already withdrawn', async () => {
    const log = baseLog({ action: 'INVITE_CREATE', entityType: 'INVITE_TOKEN', entityId: 'invite-1' });
    prisma.auditLog.findUnique.mockResolvedValue(log as any);
    mockChain([log]);
    prisma.inviteToken.findUnique.mockResolvedValue(fullInvite({ revokedAt: new Date() }) as any);
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-1'] });
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
  });
});

// These cover the "revert to an older point in this record's own history"
// cascade: reverting a log that is no longer the latest active one for its
// entity walks every later, still-active log for that SAME entity backwards
// first. The key guarantee under test isn't just "it undoes more than one
// row" — it's that it NEVER reaches across into a different entity's history
// to do so, even when that other entity's changes are interleaved in time.
describe('revertAuditLog — cascading through an entity’s own later changes', () => {
  it('undoes later gmina changes first, then the requested one, in newest-to-oldest order', async () => {
    const log1 = baseLog({
      id: 'log-1',
      action: 'GMINA_UPDATE',
      entityType: 'GMINA',
      entityId: 'gmina-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      before: { name: 'Nazwa A', powiat: null, voivodeship: null, latitude: null, longitude: null },
      after: { name: 'Nazwa B', powiat: null, voivodeship: null, latitude: null, longitude: null, updatedAt: '2026-01-02T00:00:00.000Z' },
    });
    const log2 = baseLog({
      id: 'log-2',
      action: 'GMINA_UPDATE',
      entityType: 'GMINA',
      entityId: 'gmina-1',
      createdAt: new Date('2026-01-03T00:00:00Z'),
      before: { name: 'Nazwa B', powiat: null, voivodeship: null, latitude: null, longitude: null },
      after: { name: 'Nazwa C', powiat: null, voivodeship: null, latitude: null, longitude: null, updatedAt: '2026-01-04T00:00:00.000Z' },
    });

    prisma.auditLog.findUnique.mockResolvedValue(log1 as any);
    mockChain([log1, log2]); // ascending by createdAt, as the DB would return them
    prisma.gmina.findUnique.mockResolvedValue(fullGmina() as any);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-2', 'log-1'] });
    // log-2 (newest) reverted first: the write is keyed on log-2's own
    // "after" fields ('Nazwa C'), restoring 'Nazwa B'...
    expect(prisma.gmina.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'gmina-1', name: 'Nazwa C', powiat: null, voivodeship: null, latitude: null, longitude: null },
      data: expect.objectContaining({ name: 'Nazwa B' }),
    });
    // ...then log-1, keyed on ITS "after" ('Nazwa B'), restoring 'Nazwa A'.
    expect(prisma.gmina.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'gmina-1', name: 'Nazwa B', powiat: null, voivodeship: null, latitude: null, longitude: null },
      data: expect.objectContaining({ name: 'Nazwa A' }),
    });
    expect(prisma.auditLog.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'log-2' } })
    );
    expect(prisma.auditLog.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: 'log-1' } })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it("scopes the chain query to only this entity — never sweeps in a different entity's interleaved history", async () => {
    const log1 = baseLog({
      id: 'log-1',
      seq: 7,
      action: 'GMINA_UPDATE',
      entityType: 'GMINA',
      entityId: 'gmina-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      before: { name: 'Nazwa A' },
      after: { updatedAt: '2026-01-02T00:00:00.000Z' },
    });

    prisma.auditLog.findUnique.mockResolvedValue(log1 as any);
    mockChain([log1]);
    prisma.gmina.findUnique.mockResolvedValue(fullGmina() as any);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    await revertAuditLog('log-1', ACTOR);

    // The query that discovers "what else needs undoing first" is filtered
    // to this exact entity — a user edit that happened in between two gmina
    // renames lives under a different entityId and is never fetched here.
    // Ordered/filtered by `seq` (a real monotonic DB counter), not
    // createdAt/id — two same-entity rows can land in the same millisecond,
    // and cuids are only roughly time-ordered, not guaranteed to be.
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entityType: 'GMINA', entityId: 'gmina-1', seq: { gte: 7 } }),
        orderBy: { seq: 'asc' },
      })
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses to cascade past a later action on the same entity that cannot be undone (e.g. the user was deleted since)', async () => {
    const updateLog = baseLog({
      id: 'log-1',
      action: 'USER_UPDATE',
      entityType: 'USER',
      entityId: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const deleteLog = baseLog({
      id: 'log-2',
      action: 'USER_DELETE',
      entityType: 'USER',
      entityId: 'user-1',
      createdAt: new Date('2026-01-05T00:00:00Z'),
    });

    prisma.auditLog.findUnique.mockResolvedValue(updateLog as any);
    mockChain([updateLog, deleteLog]);

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('USER_DELETE');
    }
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('aborts the entire cascade with no bookkeeping writes when an intervening step conflicts', async () => {
    const log1 = baseLog({
      id: 'log-1',
      action: 'GMINA_UPDATE',
      entityType: 'GMINA',
      entityId: 'gmina-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      after: { updatedAt: '2026-01-02T00:00:00.000Z' },
    });
    const log2 = baseLog({
      id: 'log-2',
      action: 'GMINA_UPDATE',
      entityType: 'GMINA',
      entityId: 'gmina-1',
      createdAt: new Date('2026-01-03T00:00:00Z'),
      after: { updatedAt: '2026-01-04T00:00:00.000Z' },
    });

    prisma.auditLog.findUnique.mockResolvedValue(log1 as any);
    mockChain([log1, log2]);
    prisma.gmina.findUnique.mockResolvedValue(fullGmina() as any);
    prisma.gmina.findFirst.mockResolvedValue(null);
    // log-2 is processed first (newest) — simulate someone else having
    // changed the gmina in between, so this conditional write matches nothing.
    prisma.gmina.updateMany.mockResolvedValue({ count: 0 });

    const result = await revertAuditLog('log-1', ACTOR);

    expect(result).toEqual({ ok: false, status: 409, error: expect.any(String) });
    // Never got to log-1's own write, and no revert bookkeeping was persisted
    // for either step — the whole chain is one transaction, all or nothing.
    expect(prisma.gmina.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

// Regression coverage for a real bug found in review: GMINA_CREATE/DELETE and
// INVITE_CREATE/REVOKE are structural opposites (create↔delete, revoke↔
// un-revoke), but the synthetic "revert" row created by a revert keeps the
// SAME action code as what it reverted. Dispatching purely on that action
// code meant reverting a *revert* of one of these re-ran the same branch a
// second time instead of the opposite one — for INVITE_CREATE specifically,
// that branch's "already withdrawn, nothing to do" early return made it
// return a false {ok:true} success while silently leaving the invite exactly
// as revoked as before.
describe('revertAuditLog — reverting a revert ("redo")', () => {
  it('un-revokes the invite when reverting the revert-record of an INVITE_CREATE (not a false no-op)', async () => {
    // This row IS a revert: it was created when someone reverted the
    // original INVITE_CREATE, which revoked the invite as a result.
    const revertRow = baseLog({
      id: 'log-revert-1',
      action: 'INVITE_CREATE',
      entityType: 'INVITE_TOKEN',
      entityId: 'invite-1',
      isRevert: true,
      before: { revokedAt: null },
      after: {},
    });
    prisma.auditLog.findUnique.mockResolvedValue(revertRow as any);
    mockChain([revertRow]);
    const revokedAt = new Date('2026-04-01T00:00:00Z');
    prisma.inviteToken.findUnique.mockResolvedValue(fullInvite({ revokedAt }) as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-revert-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-revert-1'] });
    // Must take the un-revoke path (INVITE_REVOKE's branch), never
    // INVITE_CREATE's own "revoke" branch — which would have hit its
    // "already withdrawn" early return and reported false success with no
    // actual write at all.
    expect(prisma.inviteToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-1', revokedAt },
      data: { revokedAt: null },
    });
  });

  it('re-revokes the invite when reverting the revert-record of an INVITE_REVOKE', async () => {
    const revertRow = baseLog({
      id: 'log-revert-1',
      action: 'INVITE_REVOKE',
      entityType: 'INVITE_TOKEN',
      entityId: 'invite-1',
      isRevert: true,
      before: {},
      after: { revokedAt: null },
    });
    prisma.auditLog.findUnique.mockResolvedValue(revertRow as any);
    mockChain([revertRow]);
    prisma.inviteToken.findUnique.mockResolvedValue(fullInvite({ revokedAt: null }) as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-revert-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-revert-1'] });
    // Must take INVITE_CREATE's "revoke" branch, not INVITE_REVOKE's own
    // "un-revoke" branch (which would hit "nie jest unieważnione" instead).
    expect(prisma.inviteToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-1', revokedAt: null, usedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('recreates the gmina when reverting the revert-record of a GMINA_CREATE', async () => {
    const revertRow = baseLog({
      id: 'log-revert-1',
      action: 'GMINA_CREATE',
      entityType: 'GMINA',
      entityId: 'gmina-1',
      isRevert: true,
      before: { name: 'Odzyskana', powiat: null, voivodeship: null, latitude: null, longitude: null },
      after: {},
    });
    prisma.auditLog.findUnique.mockResolvedValue(revertRow as any);
    mockChain([revertRow]);
    prisma.gmina.findUnique.mockResolvedValue(null); // currently deleted
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({} as any);
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-revert-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-revert-1'] });
    // Must take GMINA_DELETE's "recreate" branch, not attempt to delete an
    // already-deleted gmina a second time.
    expect(prisma.gmina.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 'gmina-1', name: 'Odzyskana' }) })
    );
    expect(prisma.gmina.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the gmina again when reverting the revert-record of a GMINA_DELETE', async () => {
    const revertRow = baseLog({
      id: 'log-revert-1',
      action: 'GMINA_DELETE',
      entityType: 'GMINA',
      entityId: 'gmina-1',
      isRevert: true,
      before: {},
      after: { name: 'Odzyskana' },
    });
    prisma.auditLog.findUnique.mockResolvedValue(revertRow as any);
    mockChain([revertRow]);
    prisma.gmina.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-revert-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-revert-1'] });
    // Must take GMINA_CREATE's "delete" branch, not GMINA_DELETE's own
    // "recreate" branch (which would hit "już istnieje" instead).
    expect(prisma.gmina.deleteMany).toHaveBeenCalledWith({ where: { id: 'gmina-1' } });
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('recreates the organization when reverting the revert-record of an ORGANIZATION_CREATE', async () => {
    const revertRow = baseLog({
      id: 'log-revert-1',
      action: 'ORGANIZATION_CREATE',
      entityType: 'ORGANIZATION',
      entityId: 'org-1',
      isRevert: true,
      before: { name: 'Odzyskana', gminaId: 'gmina-1' },
      after: {},
    });
    prisma.auditLog.findUnique.mockResolvedValue(revertRow as any);
    mockChain([revertRow]);
    prisma.organization.findUnique.mockResolvedValue(null); // currently deleted
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({} as any);
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-revert-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-revert-1'] });
    // Must take ORGANIZATION_DELETE's "recreate" branch, not attempt to
    // delete an already-deleted organization a second time.
    expect(prisma.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 'org-1', name: 'Odzyskana' }) })
    );
    expect(prisma.organization.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the organization again when reverting the revert-record of an ORGANIZATION_DELETE', async () => {
    const revertRow = baseLog({
      id: 'log-revert-1',
      action: 'ORGANIZATION_DELETE',
      entityType: 'ORGANIZATION',
      entityId: 'org-1',
      isRevert: true,
      before: {},
      after: { name: 'Odzyskana', gminaId: 'gmina-1' },
    });
    prisma.auditLog.findUnique.mockResolvedValue(revertRow as any);
    mockChain([revertRow]);
    prisma.organization.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-revert-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-revert-1'] });
    // Must take ORGANIZATION_CREATE's "delete" branch, not
    // ORGANIZATION_DELETE's own "recreate" branch (which would hit "już
    // istnieje" instead).
    expect(prisma.organization.deleteMany).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('still restores a plain field edit normally when reverting the revert-record of a GMINA_UPDATE (no direction flip needed)', async () => {
    const updatedAt = new Date('2026-05-01T00:00:00Z');
    const revertRow = baseLog({
      id: 'log-revert-1',
      action: 'GMINA_UPDATE',
      entityType: 'GMINA',
      entityId: 'gmina-1',
      isRevert: true,
      before: { name: 'Wersja Robocza', powiat: null, voivodeship: null, latitude: null, longitude: null },
      after: { name: 'Wersja Po Cofnięciu', powiat: null, voivodeship: null, latitude: null, longitude: null, updatedAt: updatedAt.toISOString() },
    });
    prisma.auditLog.findUnique.mockResolvedValue(revertRow as any);
    mockChain([revertRow]);
    prisma.gmina.findUnique.mockResolvedValue(fullGmina({ name: 'Wersja Po Cofnięciu' }) as any);
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.update.mockResolvedValue({} as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const result = await revertAuditLog('log-revert-1', ACTOR);

    expect(result).toEqual({ ok: true, revertedLogIds: ['log-revert-1'] });
    expect(prisma.gmina.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Wersja Robocza' }) })
    );
  });
});
