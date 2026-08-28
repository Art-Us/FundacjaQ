import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/prisma');
vi.mock('@/lib/rateLimit', () => ({
  consumeLimit: vi.fn(),
  inviteAcceptLimiter: {},
}));
vi.mock('@/lib/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/password')>();
  return { ...actual, isPasswordPwned: vi.fn() };
});
vi.mock('@/lib/attemptTracker', () => ({
  getAttemptCount: vi.fn(),
  recordAttempt: vi.fn(),
}));
vi.mock('@/lib/captcha', () => ({
  verifyCaptcha: vi.fn(),
}));
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { consumeLimit } from '@/lib/rateLimit';
import { isPasswordPwned } from '@/lib/password';
import { getAttemptCount, recordAttempt } from '@/lib/attemptTracker';
import { verifyCaptcha } from '@/lib/captcha';
import { headers } from 'next/headers';
import { hashToken } from '@/lib/tokens';
import { acceptInvite } from './actions';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const RAW_TOKEN = 'a-raw-invite-token';
const STRONG_PASSWORD = 'MyVolunteerPassword2026!';

function baseInvite(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv1',
    email: 'volunteer@example.com',
    role: 'VOLUNTEER',
    gminaId: null,
    tokenHash: hashToken(RAW_TOKEN),
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(prisma);
  prisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])) as any
  );
  vi.mocked(consumeLimit).mockReset().mockResolvedValue(true);
  vi.mocked(isPasswordPwned).mockReset().mockResolvedValue(false);
  vi.mocked(getAttemptCount).mockReset().mockResolvedValue(0);
  vi.mocked(recordAttempt).mockReset().mockResolvedValue(undefined as any);
  vi.mocked(verifyCaptcha).mockReset().mockResolvedValue(true);
  vi.mocked(headers).mockReset().mockReturnValue(new Headers({ 'x-forwarded-for': '10.0.0.1' }) as any);
  prisma.user.findUnique.mockResolvedValue(null);
});

describe('acceptInvite', () => {
  it('creates the user with the invite role/gminaId and marks the invite used on success', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ gminaId: 'g1' }) as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.user.create.mockResolvedValue({} as any);

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(result.ok).toBe(true);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'volunteer@example.com',
          role: 'VOLUNTEER',
          gminaId: 'g1',
          isActive: true,
          emailVerified: expect.any(Date),
        }),
      })
    );
  });

  it('rejects a password/confirmation mismatch before touching the database', async () => {
    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, 'SomethingElse2026!');

    expect(result).toEqual({ ok: false, error: 'Hasła nie są identyczne.' });
    expect(prisma.inviteToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a weak password before touching the database', async () => {
    const result = await acceptInvite(RAW_TOKEN, 'short1!', 'short1!');

    expect(result.ok).toBe(false);
    expect(prisma.inviteToken.findUnique).not.toHaveBeenCalled();
  });

  it('produces an identical generic error for nonexistent, expired, used, and revoked invites', async () => {
    prisma.inviteToken.findUnique.mockResolvedValueOnce(null);
    const missing = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    prisma.inviteToken.findUnique.mockResolvedValueOnce(baseInvite({ expiresAt: new Date(Date.now() - 1000) }) as any);
    const expired = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    prisma.inviteToken.findUnique.mockResolvedValueOnce(baseInvite({ usedAt: new Date() }) as any);
    const used = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    prisma.inviteToken.findUnique.mockResolvedValueOnce(baseInvite({ revokedAt: new Date() }) as any);
    const revoked = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(missing.ok).toBe(false);
    expect(missing).toEqual(expired);
    expect(missing).toEqual(used);
    expect(missing).toEqual(revoked);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a breached password without marking the invite used', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite() as any);
    vi.mocked(isPasswordPwned).mockResolvedValue(true);

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(result.ok).toBe(false);
    expect(prisma.inviteToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects when the email is already registered, without leaking a raw DB error', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite() as any);
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' } as any);

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(result).toEqual({ ok: false, error: 'Konto dla tego adresu email już istnieje.' });
  });

  it('rejects a simulated double-accept race (second updateMany reports count 0)', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite() as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 0 } as any);

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(result).toEqual({ ok: false, error: 'Link zaproszenia został już wykorzystany.' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('surfaces a generic error (not a raw DB error) if the transaction throws a unique-constraint-like error', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite() as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.user.create.mockRejectedValue(new Error('Unique constraint failed on the fields: (`email`)'));

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('Unique constraint');
  });

  it('makes no database calls when rate-limited', async () => {
    vi.mocked(consumeLimit).mockResolvedValue(false);

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(result.ok).toBe(false);
    expect(prisma.inviteToken.findUnique).not.toHaveBeenCalled();
  });
});

describe('captcha gate', () => {
  it('does not require captcha (and never calls verifyCaptcha) below the attempt thresholds', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ gminaId: 'g1' }) as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.user.create.mockResolvedValue({} as any);

    await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it('rejects with captchaRequired once the token has been retried enough times without a valid captcha', async () => {
    vi.mocked(getAttemptCount).mockImplementation(async (scope: string) => (scope === 'invite-accept-token' ? 2 : 0));
    vi.mocked(verifyCaptcha).mockResolvedValue(false);

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(result).toMatchObject({ ok: false, captchaRequired: true });
    expect(prisma.inviteToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects with captchaRequired once the IP alone has been retried enough times', async () => {
    vi.mocked(getAttemptCount).mockImplementation(async (scope: string) => (scope === 'invite-accept-ip' ? 3 : 0));
    vi.mocked(verifyCaptcha).mockResolvedValue(false);

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD);

    expect(result).toMatchObject({ ok: false, captchaRequired: true });
  });

  it('proceeds with a valid captcha token once required', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(baseInvite({ gminaId: 'g1' }) as any);
    prisma.inviteToken.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.user.create.mockResolvedValue({} as any);
    vi.mocked(getAttemptCount).mockImplementation(async (scope: string) => (scope === 'invite-accept-token' ? 2 : 0));
    vi.mocked(verifyCaptcha).mockResolvedValue(true);

    const result = await acceptInvite(RAW_TOKEN, STRONG_PASSWORD, STRONG_PASSWORD, 'valid-token');

    expect(result.ok).toBe(true);
    expect(verifyCaptcha).toHaveBeenCalledWith('valid-token', '10.0.0.1');
  });
});