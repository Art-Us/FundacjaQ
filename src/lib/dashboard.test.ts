import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');

import { prisma as prismaImport } from './prisma';
import { getDashboardData } from './dashboard';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prisma);
});

describe('getDashboardData — ADMIN', () => {
  it('gets full, unrestricted data with no gmina filter at all', async () => {
    prisma.alert.count.mockResolvedValue(5);
    prisma.gmina.count.mockResolvedValue(3);
    prisma.user.count.mockResolvedValue(20);
    prisma.alert.findMany.mockResolvedValue([{ id: 'a1' }] as any);
    prisma.resource.findMany.mockResolvedValue([{ id: 'r1' }] as any);

    const result = await getDashboardData('ADMIN', null);

    expect(result.scopeLabel).toBe('Wszystkie gminy');
    expect(result.canManageInvites).toBe(true);
    expect(result.stats).toEqual({ activeAlerts: 5, gminyCount: 3, usersCount: 20 });
    expect(result.alerts).toEqual([{ id: 'a1' }]);
    expect(result.resources).toEqual([{ id: 'r1' }]);

    expect(prisma.alert.count).toHaveBeenCalledWith({
      where: { status: { in: ['ACTIVE', 'IN_PROGRESS'] } },
    });
    // ADMIN is not gmina-scoped, so the user count is unfiltered (no `where` at all).
    expect(prisma.user.count).toHaveBeenCalledWith(undefined);
    expect(prisma.alert.findMany).toHaveBeenCalledWith({
      where: {},
      include: { gmina: true },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    });
    expect(prisma.resource.findMany).toHaveBeenCalledWith({
      where: {},
      include: { gmina: true, category: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
  });

  it('still counts all gminy even when ADMIN has no gminaId of their own', async () => {
    prisma.alert.count.mockResolvedValue(0);
    prisma.gmina.count.mockResolvedValue(7);
    prisma.user.count.mockResolvedValue(0);
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.resource.findMany.mockResolvedValue([]);

    const result = await getDashboardData('ADMIN', null);

    expect(result.stats.gminyCount).toBe(7);
  });
});

describe('getDashboardData — gmina-scoped role WITH a gminaId', () => {
  it('scopes COORDINATOR data to their own gmina, including gminyCount (never the system-wide total)', async () => {
    prisma.alert.count.mockResolvedValue(2);
    prisma.user.count.mockResolvedValue(4);
    prisma.alert.findMany.mockResolvedValue([{ id: 'a1' }] as any);
    prisma.resource.findMany.mockResolvedValue([{ id: 'r1' }] as any);

    const result = await getDashboardData('COORDINATOR', 'gmina-1');

    expect(result.scopeLabel).toBe('Twoja gmina');
    expect(result.canManageInvites).toBe(true);
    expect(result.stats).toEqual({ activeAlerts: 2, gminyCount: 1, usersCount: 4 });
    expect(prisma.gmina.count).not.toHaveBeenCalled();

    expect(prisma.alert.count).toHaveBeenCalledWith({
      where: { gminaId: 'gmina-1', status: { in: ['ACTIVE', 'IN_PROGRESS'] } },
    });
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { gminaId: 'gmina-1' } });
    expect(prisma.alert.findMany).toHaveBeenCalledWith({
      where: { gminaId: 'gmina-1' },
      include: { gmina: true },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    });
    expect(prisma.resource.findMany).toHaveBeenCalledWith({
      where: { gminaId: 'gmina-1' },
      include: { gmina: true, category: true },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });
  });

  it('scopes VOLUNTEER data to their own gmina but denies invite management', async () => {
    prisma.alert.count.mockResolvedValue(1);
    prisma.gmina.count.mockResolvedValue(3);
    prisma.user.count.mockResolvedValue(9);
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.resource.findMany.mockResolvedValue([]);

    const result = await getDashboardData('VOLUNTEER', 'gmina-2');

    expect(result.scopeLabel).toBe('Twoja gmina');
    expect(result.canManageInvites).toBe(false);
    expect(prisma.alert.count).toHaveBeenCalledWith({
      where: { gminaId: 'gmina-2', status: { in: ['ACTIVE', 'IN_PROGRESS'] } },
    });
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { gminaId: 'gmina-2' } });
  });

  // A gmina-scoped ADMIN (role === 'ADMIN', gminaId set) is scoped exactly
  // like COORDINATOR/VOLUNTEER everywhere now, alerts/resources included —
  // only a global ADMIN (gminaId === null) sees every gmina's.
  it('scopes a gmina-scoped ADMIN\'s usersCount/gminyCount/alerts/resources to their own gmina', async () => {
    prisma.alert.count.mockResolvedValue(2);
    prisma.user.count.mockResolvedValue(4);
    prisma.alert.findMany.mockResolvedValue([{ id: 'a1' }] as any);
    prisma.resource.findMany.mockResolvedValue([{ id: 'r1' }] as any);

    const result = await getDashboardData('ADMIN', 'gmina-1');

    expect(result.scopeLabel).toBe('Twoja gmina');
    expect(result.stats).toEqual({ activeAlerts: 2, gminyCount: 1, usersCount: 4 });
    expect(prisma.gmina.count).not.toHaveBeenCalled();
    expect(prisma.alert.count).toHaveBeenCalledWith({
      where: { gminaId: 'gmina-1', status: { in: ['ACTIVE', 'IN_PROGRESS'] } },
    });
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { gminaId: 'gmina-1' } });
    expect(prisma.alert.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { gminaId: 'gmina-1' } }));
    expect(prisma.resource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { gminaId: 'gmina-1' } }));
  });
});

// Regression coverage mirroring scopedGminaWhere's fail-closed contract
// (see gmina.ts's doc comment and the 2026-09-10 audit finding, which named
// dashboard.ts specifically): a gmina-scoped actor with NO gmina of their own
// must get zeroed-out data, never the unrestricted, all-gminy view.
describe('getDashboardData — gmina-scoped role with NO gminaId (fail-closed)', () => {
  it('zeroes out alerts/resources/user counts for COORDINATOR, never falling back to unrestricted data', async () => {
    prisma.gmina.count.mockResolvedValue(3);

    const result = await getDashboardData('COORDINATOR', null);

    expect(result.scopeLabel).toBe('Brak przypisanej gminy');
    expect(result.stats).toEqual({ activeAlerts: 0, gminyCount: 3, usersCount: 0 });
    expect(result.alerts).toEqual([]);
    expect(result.resources).toEqual([]);
    // canManageInvites is role-based, independent of gmina scoping.
    expect(result.canManageInvites).toBe(true);

    expect(prisma.alert.count).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.alert.findMany).not.toHaveBeenCalled();
    expect(prisma.resource.findMany).not.toHaveBeenCalled();
  });

  it('zeroes out data for VOLUNTEER with no gmina the same way', async () => {
    prisma.gmina.count.mockResolvedValue(3);

    const result = await getDashboardData('VOLUNTEER', null);

    expect(result.scopeLabel).toBe('Brak przypisanej gminy');
    expect(result.stats).toEqual({ activeAlerts: 0, gminyCount: 3, usersCount: 0 });
    expect(result.alerts).toEqual([]);
    expect(result.resources).toEqual([]);
    expect(result.canManageInvites).toBe(false);

    expect(prisma.alert.count).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('still counts the total number of gminy even though this actor has no gmina', async () => {
    prisma.gmina.count.mockResolvedValue(11);

    const result = await getDashboardData('COORDINATOR', null);

    expect(result.stats.gminyCount).toBe(11);
    expect(prisma.gmina.count).toHaveBeenCalledWith();
  });
});
