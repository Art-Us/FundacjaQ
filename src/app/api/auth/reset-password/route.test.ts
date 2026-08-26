import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/rateLimit', () => ({
  consumeLimit: vi.fn(),
  passwordResetLimiter: {},
}));
vi.mock('@/lib/lockout', () => ({
  resetAttempts: vi.fn(),
}));
vi.mock('@/lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/password')>();
  return { ...actual, isPasswordPwned: vi.fn() };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { consumeLimit } from '@/lib/rateLimit';
import { resetAttempts } from '@/lib/lockout';
import { isPasswordPwned } from '@/lib/password';
import { hashToken } from '@/lib/tokens';
import { POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const RAW_TOKEN = 'a-raw-reset-token';
const STRONG_PASSWORD = 'BrandNewStrongPass99!';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '5.6.7.8' },
    body: JSON.stringify(body),
  });
}

function baseToken(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rt1',
    userId: 'u1',
    tokenHash: hashToken(RAW_TOKEN),
    usedAt: null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    user: { id: 'u1', email: 'user@example.com' },
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(prisma);
  prisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])) as any
  );
  vi.mocked(consumeLimit).mockReset().mockResolvedValue(true);
  vi.mocked(resetAttempts).mockReset().mockResolvedValue(undefined);
  vi.mocked(isPasswordPwned).mockReset().mockResolvedValue(false);
});

describe('POST /api/auth/reset-password', () => {
  it('resets the password, marks the token used, and clears lockout state on success', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(baseToken() as any);
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.user.update.mockResolvedValue({} as any);

    const res = await POST(makeRequest({ token: RAW_TOKEN, password: STRONG_PASSWORD }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain('zostało zmienione');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ passwordChangedAt: expect.any(Date), failedAttempts: 0, lockedUntil: null }),
      })
    );
    expect(resetAttempts).toHaveBeenCalledWith('user@example.com');
  });

  it('produces an identical generic error for a nonexistent, an expired, and an already-used token', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValueOnce(null);
    const missing = await POST(makeRequest({ token: 'nope', password: STRONG_PASSWORD }));
    const missingBody = await missing.json();

    prisma.passwordResetToken.findUnique.mockResolvedValueOnce(
      baseToken({ expiresAt: new Date(Date.now() - 1000) }) as any
    );
    const expired = await POST(makeRequest({ token: RAW_TOKEN, password: STRONG_PASSWORD }));
    const expiredBody = await expired.json();

    prisma.passwordResetToken.findUnique.mockResolvedValueOnce(baseToken({ usedAt: new Date() }) as any);
    const used = await POST(makeRequest({ token: RAW_TOKEN, password: STRONG_PASSWORD }));
    const usedBody = await used.json();

    expect(missing.status).toBe(400);
    expect(expired.status).toBe(400);
    expect(used.status).toBe(400);
    expect(missingBody).toEqual(expiredBody);
    expect(missingBody).toEqual(usedBody);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a breached password without marking the token used (so a retry can still succeed)', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(baseToken() as any);
    vi.mocked(isPasswordPwned).mockResolvedValue(true);

    const res = await POST(makeRequest({ token: RAW_TOKEN, password: STRONG_PASSWORD }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('wycieków');
    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than 12 characters via zod before any DB call', async () => {
    const res = await POST(makeRequest({ token: RAW_TOKEN, password: 'short1!' }));

    expect(res.status).toBe(400);
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a simulated concurrent double-reset (second updateMany reports count 0)', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(baseToken() as any);
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 } as any);

    const res = await POST(makeRequest({ token: RAW_TOKEN, password: STRONG_PASSWORD }));

    expect(res.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('makes zero database calls when rate-limited', async () => {
    vi.mocked(consumeLimit).mockResolvedValue(false);

    const res = await POST(makeRequest({ token: RAW_TOKEN, password: STRONG_PASSWORD }));

    expect(res.status).toBe(429);
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});
