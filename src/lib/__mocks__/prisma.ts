import { vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

export const prisma = mockDeep<PrismaClient>();

/**
 * Makes `prisma.$transaction(...)` run its argument against this same mock
 * instead of doing nothing — the array form resolves each promise, the
 * interactive/callback form invokes the callback with `tx` bound to `prisma`
 * itself, so `tx.model.method(...)` calls land on whatever the test already
 * configured.
 *
 * `mockReset(prisma)` (used in every test file's `beforeEach`, per this
 * project's convention) wipes this implementation along with everything
 * else, so any test that exercises code using `$transaction` must call this
 * again after `mockReset(prisma)` — see e.g. lib/auditLog.test.ts.
 */
export function installTransactionMock(client: DeepMockProxy<PrismaClient> = prisma): void {
  vi.mocked(client.$transaction).mockImplementation(((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof client) => unknown)(client);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }) as any);
}

installTransactionMock();
