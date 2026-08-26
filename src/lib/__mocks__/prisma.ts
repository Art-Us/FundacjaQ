import { vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

export const prisma = mockDeep<PrismaClient>();

vi.mocked(prisma.$transaction).mockImplementation(((arg: unknown) => {
  if (typeof arg === 'function') {
    return (arg as (tx: typeof prisma) => unknown)(prisma);
  }
  return Promise.all(arg as Promise<unknown>[]);
}) as any);
