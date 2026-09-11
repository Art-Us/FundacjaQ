import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');

import { prisma as prismaImport } from './prisma';
import { isLastActiveAdmin } from './authz';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

beforeEach(() => {
  mockReset(prisma);
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
