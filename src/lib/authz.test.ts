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
  requireAdmin,
  requireAdminOrCoordinator,
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
  const alert = { organizationId: 'org-owner' };

  it('is always true for ADMIN, regardless of organization', () => {
    expect(canManageAlert(alert, { role: 'ADMIN', organizationId: null })).toBe(true);
  });

  it('is true for a COORDINATOR whose organization owns the alert', () => {
    expect(canManageAlert(alert, { role: 'COORDINATOR', organizationId: 'org-owner' })).toBe(true);
  });

  it('is false for a COORDINATOR from a different organization, even in the same gmina', () => {
    expect(canManageAlert(alert, { role: 'COORDINATOR', organizationId: 'org-other' })).toBe(false);
  });

  it('is never true for VOLUNTEER, even when their organization owns the alert', () => {
    expect(canManageAlert(alert, { role: 'VOLUNTEER', organizationId: 'org-owner' })).toBe(false);
  });
});
