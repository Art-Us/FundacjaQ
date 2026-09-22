import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma as prismaImport } from './prisma';
import { getServerSession } from 'next-auth';
import {
  isLastActiveAdmin,
  isAlertOwnerOrg,
  isAllocationDonor,
  isAllocationRecipient,
  canManageAlert,
  canManageUser,
  isGlobalAdmin,
  isGminaScopedAdmin,
  scopedAdminManagementWhere,
  requireAdmin,
  requireAdminOrCoordinator,
  requireGlobalAdmin,
} from './authz';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function mockSession(role: string | null) {
  vi.mocked(getServerSession).mockResolvedValue(
    role ? ({ user: { id: 'session-user', role, gminaId: null } } as any) : null
  );
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(getServerSession).mockReset();
});

describe('requireAdmin', () => {
  it('returns the user for an ADMIN session', async () => {
    mockSession('ADMIN');
    const result = await requireAdmin();
    expect(result).toMatchObject({ role: 'ADMIN' });
  });

  it('returns null for a COORDINATOR session', async () => {
    mockSession('COORDINATOR');
    expect(await requireAdmin()).toBeNull();
  });

  it('returns null for a VOLUNTEER session', async () => {
    mockSession('VOLUNTEER');
    expect(await requireAdmin()).toBeNull();
  });

  it('returns null when there is no session at all', async () => {
    mockSession(null);
    expect(await requireAdmin()).toBeNull();
  });
});

describe('requireAdminOrCoordinator', () => {
  it('returns the user for an ADMIN session', async () => {
    mockSession('ADMIN');
    const result = await requireAdminOrCoordinator();
    expect(result).toMatchObject({ role: 'ADMIN' });
  });

  it('returns the user for a COORDINATOR session', async () => {
    mockSession('COORDINATOR');
    const result = await requireAdminOrCoordinator();
    expect(result).toMatchObject({ role: 'COORDINATOR' });
  });

  it('returns null for a VOLUNTEER session', async () => {
    mockSession('VOLUNTEER');
    expect(await requireAdminOrCoordinator()).toBeNull();
  });

  it('returns null when there is no session at all', async () => {
    mockSession(null);
    expect(await requireAdminOrCoordinator()).toBeNull();
  });
});

describe('isLastActiveAdmin', () => {
  it('is false for a non-admin role, without touching the database', async () => {
    const result = await isLastActiveAdmin({ role: 'VOLUNTEER', isActive: true });

    expect(result).toBe(false);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('is false for an already-inactive admin, without touching the database', async () => {
    const result = await isLastActiveAdmin({ role: 'ADMIN', isActive: false });

    expect(result).toBe(false);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('is true when this is the only active admin', async () => {
    prisma.user.count.mockResolvedValue(1);

    const result = await isLastActiveAdmin({ role: 'ADMIN', isActive: true });

    expect(result).toBe(true);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { role: 'ADMIN', isActive: true } });
  });

  it('is false when other active admins exist', async () => {
    prisma.user.count.mockResolvedValue(2);

    const result = await isLastActiveAdmin({ role: 'ADMIN', isActive: true });

    expect(result).toBe(false);
  });
});

describe('isAlertOwnerOrg', () => {
  it('is true when the user organization matches the alert organization', () => {
    expect(isAlertOwnerOrg({ organizationId: 'org-1' }, { organizationId: 'org-1' })).toBe(true);
  });

  it('is false when the organizations differ', () => {
    expect(isAlertOwnerOrg({ organizationId: 'org-1' }, { organizationId: 'org-2' })).toBe(false);
  });

  it('is false when the alert has no organization', () => {
    expect(isAlertOwnerOrg({ organizationId: null }, { organizationId: 'org-1' })).toBe(false);
  });

  it('is false when the user has no organization', () => {
    expect(isAlertOwnerOrg({ organizationId: 'org-1' }, { organizationId: null })).toBe(false);
    expect(isAlertOwnerOrg({ organizationId: 'org-1' }, {})).toBe(false);
  });
});

describe('isAllocationDonor', () => {
  it('is true when the user organization is the donor', () => {
    expect(isAllocationDonor({ donorOrgId: 'org-donor' }, { organizationId: 'org-donor' })).toBe(true);
  });

  it('is false for the recipient organization (donor ≠ recipient)', () => {
    expect(isAllocationDonor({ donorOrgId: 'org-donor' }, { organizationId: 'org-recipient' })).toBe(false);
  });

  it('is false when the user has no organization', () => {
    expect(isAllocationDonor({ donorOrgId: 'org-donor' }, {})).toBe(false);
  });
});

describe('isAllocationRecipient', () => {
  it('is true when the user organization owns the allocation\'s alert', () => {
    expect(
      isAllocationRecipient({ alert: { organizationId: 'org-recipient' } }, { organizationId: 'org-recipient' })
    ).toBe(true);
  });

  it('is false for the donor organization (recipient ≠ donor)', () => {
    expect(
      isAllocationRecipient({ alert: { organizationId: 'org-recipient' } }, { organizationId: 'org-donor' })
    ).toBe(false);
  });

  it('is false when the alert has no owning organization', () => {
    expect(isAllocationRecipient({ alert: { organizationId: null } }, { organizationId: 'org-1' })).toBe(false);
  });
});

describe('canManageAlert', () => {
  const alert = { organizationId: 'org-owner', gminaId: 'gmina-1' };

  it('is always true for ADMIN, regardless of organization or gmina', () => {
    expect(canManageAlert(alert, { role: 'ADMIN', gminaId: null, organizationId: null })).toBe(true);
    expect(canManageAlert(alert, { role: 'ADMIN', gminaId: 'gmina-2', organizationId: null })).toBe(true);
  });

  it('is true for a COORDINATOR whose organization owns the alert, even in a different gmina', () => {
    expect(
      canManageAlert(alert, { role: 'COORDINATOR', gminaId: 'gmina-2', organizationId: 'org-owner' })
    ).toBe(true);
  });

  it('is true for a COORDINATOR in the same gmina, even from a different organization', () => {
    expect(
      canManageAlert(alert, { role: 'COORDINATOR', gminaId: 'gmina-1', organizationId: 'org-other' })
    ).toBe(true);
  });

  it('is false for a COORDINATOR from neither the owning organization nor the same gmina', () => {
    expect(
      canManageAlert(alert, { role: 'COORDINATOR', gminaId: 'gmina-2', organizationId: 'org-other' })
    ).toBe(false);
  });

  it('is never true for VOLUNTEER, even when their organization owns the alert', () => {
    expect(
      canManageAlert(alert, { role: 'VOLUNTEER', gminaId: 'gmina-1', organizationId: 'org-owner' })
    ).toBe(false);
  });
});

describe('isGlobalAdmin / isGminaScopedAdmin', () => {
  it('isGlobalAdmin is true only for ADMIN with no gmina', () => {
    expect(isGlobalAdmin({ role: 'ADMIN', gminaId: null })).toBe(true);
    expect(isGlobalAdmin({ role: 'ADMIN', gminaId: 'gmina-1' })).toBe(false);
    expect(isGlobalAdmin({ role: 'COORDINATOR', gminaId: null })).toBe(false);
  });

  it('isGminaScopedAdmin is true only for ADMIN with a gmina', () => {
    expect(isGminaScopedAdmin({ role: 'ADMIN', gminaId: 'gmina-1' })).toBe(true);
    expect(isGminaScopedAdmin({ role: 'ADMIN', gminaId: null })).toBe(false);
    expect(isGminaScopedAdmin({ role: 'COORDINATOR', gminaId: 'gmina-1' })).toBe(false);
  });
});

describe('requireGlobalAdmin', () => {
  it('returns the session user for a global admin', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', gminaId: null } } as any);
    expect(await requireGlobalAdmin()).toEqual({ id: 'u1', role: 'ADMIN', gminaId: null });
  });

  it('returns null for a gmina-scoped admin', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', gminaId: 'gmina-1' } } as any);
    expect(await requireGlobalAdmin()).toBeNull();
  });

  it('returns null for a non-admin', async () => {
    mockSession('COORDINATOR');
    expect(await requireGlobalAdmin()).toBeNull();
  });

  it('returns null when unauthenticated', async () => {
    mockSession(null);
    expect(await requireGlobalAdmin()).toBeNull();
  });
});

describe('canManageUser', () => {
  it('nobody can manage themselves, regardless of role', () => {
    expect(
      canManageUser(
        { id: 'u1', role: 'ADMIN', gminaId: null },
        { id: 'u1', role: 'ADMIN', gminaId: null, organizationId: null }
      )
    ).toBe(false);
  });

  it('a global admin can manage anyone, including another admin (global or gmina-scoped)', () => {
    const globalAdmin = { id: 'admin-1', role: 'ADMIN', gminaId: null };
    expect(
      canManageUser(globalAdmin, { id: 'u2', role: 'VOLUNTEER', gminaId: 'gmina-1', organizationId: 'org-1' })
    ).toBe(true);
    expect(
      canManageUser(globalAdmin, { id: 'u3', role: 'ADMIN', gminaId: 'gmina-1', organizationId: null })
    ).toBe(true);
    expect(canManageUser(globalAdmin, { id: 'u4', role: 'ADMIN', gminaId: null, organizationId: null })).toBe(true);
  });

  it('a gmina-scoped admin can manage a non-admin in their own gmina', () => {
    const gminaAdmin = { id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' };
    expect(
      canManageUser(gminaAdmin, { id: 'u2', role: 'VOLUNTEER', gminaId: 'gmina-1', organizationId: 'org-1' })
    ).toBe(true);
  });

  it('a gmina-scoped admin can NEVER manage a global admin, even nominally "same gmina" comparisons aside', () => {
    const gminaAdmin = { id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' };
    expect(canManageUser(gminaAdmin, { id: 'u2', role: 'ADMIN', gminaId: null, organizationId: null })).toBe(false);
  });

  it('a gmina-scoped admin CAN manage a peer gmina-scoped admin in the SAME gmina (only global admins are protected)', () => {
    const gminaAdmin = { id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' };
    expect(
      canManageUser(gminaAdmin, { id: 'u2', role: 'ADMIN', gminaId: 'gmina-1', organizationId: null })
    ).toBe(true);
  });

  it('a gmina-scoped admin cannot manage anyone (admin or not) outside their own gmina', () => {
    const gminaAdmin = { id: 'admin-1', role: 'ADMIN', gminaId: 'gmina-1' };
    expect(
      canManageUser(gminaAdmin, { id: 'u2', role: 'VOLUNTEER', gminaId: 'gmina-2', organizationId: 'org-1' })
    ).toBe(false);
    expect(
      canManageUser(gminaAdmin, { id: 'u3', role: 'ADMIN', gminaId: 'gmina-2', organizationId: null })
    ).toBe(false);
  });

  it('COORDINATOR behavior is unchanged: only their own organization\'s VOLUNTEERs', () => {
    const coordinator = { id: 'c1', role: 'COORDINATOR', gminaId: 'gmina-1', organizationId: 'org-1' };
    expect(
      canManageUser(coordinator, { id: 'v1', role: 'VOLUNTEER', gminaId: 'gmina-1', organizationId: 'org-1' })
    ).toBe(true);
    expect(
      canManageUser(coordinator, { id: 'v2', role: 'VOLUNTEER', gminaId: 'gmina-1', organizationId: 'org-2' })
    ).toBe(false);
    expect(
      canManageUser(coordinator, { id: 'c2', role: 'COORDINATOR', gminaId: 'gmina-1', organizationId: 'org-1' })
    ).toBe(false);
  });
});

describe('scopedAdminManagementWhere', () => {
  it('returns {} (unrestricted) for a global admin', () => {
    expect(scopedAdminManagementWhere({ id: 'a1', role: 'ADMIN', gminaId: null })).toEqual({});
  });

  it('returns { gminaId } for a gmina-scoped admin — gmina-wide, not organization-scoped', () => {
    expect(scopedAdminManagementWhere({ id: 'a1', role: 'ADMIN', gminaId: 'gmina-1' })).toEqual({
      gminaId: 'gmina-1',
    });
  });

  it('delegates to scopedOrganizationWhere for COORDINATOR (unchanged, organization-scoped)', () => {
    expect(
      scopedAdminManagementWhere({ id: 'c1', role: 'COORDINATOR', gminaId: 'gmina-1', organizationId: 'org-1' })
    ).toEqual({ organizationId: 'org-1' });
    expect(
      scopedAdminManagementWhere({ id: 'c2', role: 'COORDINATOR', gminaId: 'gmina-1', organizationId: null })
    ).toBeNull();
  });
});
