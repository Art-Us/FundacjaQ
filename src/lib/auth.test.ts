import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');
vi.mock('./lockout', () => ({
  checkLockout: vi.fn(),
  recordFailedAttempt: vi.fn(),
  resetAttempts: vi.fn(),
}));
vi.mock('./ipLockout', () => ({
  checkIpBlock: vi.fn(),
  recordFailedLoginByIp: vi.fn(),
  clearIpFailures: vi.fn(),
  IP_BLOCKED_MESSAGE: 'Zbyt wiele nieudanych prób logowania z tego adresu IP. Spróbuj ponownie później.',
}));
vi.mock('./rateLimit', () => ({
  consumeLimit: vi.fn(),
  loginLimiter: {},
}));
vi.mock('./attemptTracker', () => ({
  getAttemptCount: vi.fn(),
  recordAttempt: vi.fn(),
  clearAttempts: vi.fn(),
}));
vi.mock('./captcha', () => ({
  verifyCaptcha: vi.fn(),
}));

import { prisma as prismaImport } from './prisma';
import { checkLockout, recordFailedAttempt, resetAttempts } from './lockout';
import { checkIpBlock, recordFailedLoginByIp, clearIpFailures } from './ipLockout';
import { consumeLimit } from './rateLimit';
import { getAttemptCount, recordAttempt, clearAttempts } from './attemptTracker';
import { verifyCaptcha } from './captcha';
import { hashPassword } from './password';
import { authOptions } from './auth';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

type AuthorizeFn = (
  credentials: { email?: string; password?: string; captchaToken?: string } | undefined,
  req: { headers?: Record<string, string | string[] | undefined> }
) => Promise<any>;

const authorize: AuthorizeFn = (authOptions.providers[0] as any).options.authorize;

const REQ = { headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'vitest' } };

beforeEach(() => {
  mockReset(prisma);
  prisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])) as any
  );
  vi.mocked(consumeLimit).mockReset().mockResolvedValue(true);
  vi.mocked(checkLockout).mockReset().mockResolvedValue({ locked: false, until: null });
  vi.mocked(recordFailedAttempt).mockReset().mockResolvedValue(undefined);
  vi.mocked(resetAttempts).mockReset().mockResolvedValue(undefined);
  vi.mocked(checkIpBlock).mockReset().mockResolvedValue({ blocked: false, until: null });
  vi.mocked(recordFailedLoginByIp).mockReset().mockResolvedValue(undefined);
  vi.mocked(clearIpFailures).mockReset().mockResolvedValue(undefined);
  vi.mocked(getAttemptCount).mockReset().mockResolvedValue(0);
  vi.mocked(recordAttempt).mockReset().mockResolvedValue(undefined as any);
  vi.mocked(clearAttempts).mockReset().mockResolvedValue(undefined);
  vi.mocked(verifyCaptcha).mockReset().mockResolvedValue(true);
  prisma.loginAttempt.create.mockResolvedValue({} as any);
});

describe('authorize()', () => {
  it('returns the user on correct credentials for an active account', async () => {
    const passwordHash = await hashPassword('CorrectPassword123!');
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'Test User',
      role: 'VOLUNTEER',
      gminaId: null,
      isActive: true,
      passwordHash,
    } as any);

    const result = await authorize({ email: 'user@example.com', password: 'CorrectPassword123!' }, REQ);

    expect(result).toMatchObject({ id: 'u1', role: 'VOLUNTEER' });
    expect(resetAttempts).toHaveBeenCalledWith('user@example.com');
  });

  it('produces the identical error message for a wrong password and for a nonexistent user (no enumeration)', async () => {
    const passwordHash = await hashPassword('CorrectPassword123!');
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      role: 'VOLUNTEER',
      gminaId: null,
      isActive: true,
      passwordHash,
    } as any);

    let wrongPasswordError = '';
    try {
      await authorize({ email: 'user@example.com', password: 'WrongPassword!' }, REQ);
    } catch (e) {
      wrongPasswordError = (e as Error).message;
    }

    prisma.user.findUnique.mockResolvedValueOnce(null);
    let noSuchUserError = '';
    try {
      await authorize({ email: 'nobody@example.com', password: 'WhateverPassword!' }, REQ);
    } catch (e) {
      noSuchUserError = (e as Error).message;
    }

    expect(wrongPasswordError).not.toBe('');
    expect(wrongPasswordError).toBe(noSuchUserError);
  });

  it('rejects an inactive user with the same generic message (does not reveal deactivation)', async () => {
    const passwordHash = await hashPassword('CorrectPassword123!');
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'VOLUNTEER',
      gminaId: null,
      isActive: false,
      passwordHash,
    } as any);

    await expect(authorize({ email: 'user@example.com', password: 'CorrectPassword123!' }, REQ)).rejects.toThrow(
      'Nieprawidłowy email lub hasło.'
    );
  });

  it('returns null for missing credentials without touching the database', async () => {
    const result = await authorize({ email: '', password: '' }, REQ);
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when credentials are entirely undefined', async () => {
    const result = await authorize(undefined, REQ);
    expect(result).toBeNull();
  });

  it('passes an injection-shaped email through as an ordinary parameterized value', async () => {
    const maliciousEmail = "admin@example.com'; DROP TABLE \"User\";--";
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(authorize({ email: maliciousEmail, password: 'anything' }, REQ)).rejects.toThrow();

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: maliciousEmail.toLowerCase() } });
  });

  it('rejects before touching the database when the IP is blocked', async () => {
    vi.mocked(checkIpBlock).mockResolvedValue({ blocked: true, until: new Date(Date.now() + 60_000) });

    await expect(authorize({ email: 'user@example.com', password: 'x' }, REQ)).rejects.toThrow(
      'Zbyt wiele nieudanych prób logowania z tego adresu IP. Spróbuj ponownie później.'
    );
    expect(consumeLimit).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects before touching the database when the rate limit is exceeded', async () => {
    vi.mocked(consumeLimit).mockResolvedValue(false);

    await expect(authorize({ email: 'user@example.com', password: 'x' }, REQ)).rejects.toThrow(
      'Za dużo prób logowania. Spróbuj ponownie później.'
    );
    expect(checkLockout).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects before touching the database when the account is locked', async () => {
    vi.mocked(checkLockout).mockResolvedValue({ locked: true, until: new Date() });

    await expect(authorize({ email: 'user@example.com', password: 'x' }, REQ)).rejects.toThrow(
      'Konto tymczasowo zablokowane. Spróbuj ponownie później.'
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('records a failed attempt (account, IP counter, and audit log) on bad credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(authorize({ email: 'user@example.com', password: 'x' }, REQ)).rejects.toThrow();

    expect(recordFailedAttempt).toHaveBeenCalledWith('user@example.com');
    expect(recordFailedLoginByIp).toHaveBeenCalledWith('1.2.3.4');
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success: false }) })
    );
  });
});

describe('captcha gate', () => {
  it('does not require captcha (and never calls verifyCaptcha) below the account attempt threshold', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(authorize({ email: 'user@example.com', password: 'x' }, REQ)).rejects.toThrow(
      'Nieprawidłowy email lub hasło.'
    );
    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it('rejects with CAPTCHA_REQUIRED once the account has reached its attempt threshold and no valid token is supplied', async () => {
    vi.mocked(getAttemptCount).mockResolvedValue(3);
    vi.mocked(verifyCaptcha).mockResolvedValue(false);

    await expect(authorize({ email: 'user@example.com', password: 'x' }, REQ)).rejects.toThrow('CAPTCHA_REQUIRED');
    expect(verifyCaptcha).toHaveBeenCalledWith(undefined, '1.2.3.4');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(recordFailedAttempt).toHaveBeenCalledWith('user@example.com');
  });

  it('proceeds past the captcha gate with a valid token once required', async () => {
    const passwordHash = await hashPassword('CorrectPassword123!');
    vi.mocked(getAttemptCount).mockResolvedValue(3);
    vi.mocked(verifyCaptcha).mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: null,
      role: 'VOLUNTEER',
      gminaId: null,
      isActive: true,
      passwordHash,
    } as any);

    const result = await authorize(
      { email: 'user@example.com', password: 'CorrectPassword123!', captchaToken: 'valid-token' },
      REQ
    );

    expect(result).toMatchObject({ id: 'u1' });
    expect(verifyCaptcha).toHaveBeenCalledWith('valid-token', '1.2.3.4');
  });

  it('clears the account attempt counter and the IP failure counter on a successful login', async () => {
    const passwordHash = await hashPassword('CorrectPassword123!');
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: null,
      role: 'VOLUNTEER',
      gminaId: null,
      isActive: true,
      passwordHash,
    } as any);

    await authorize({ email: 'user@example.com', password: 'CorrectPassword123!' }, REQ);

    expect(clearAttempts).toHaveBeenCalledWith('login-account', 'user@example.com');
    expect(clearIpFailures).toHaveBeenCalledWith('1.2.3.4');
  });
});

describe('jwt callback', () => {
  const jwt = authOptions.callbacks!.jwt!;

  it('embeds role/gminaId on initial sign-in', async () => {
    const token = await jwt({
      token: {},
      user: { id: 'u1', role: 'ADMIN', gminaId: 'g1' } as any,
    } as any);

    expect(token).toMatchObject({ role: 'ADMIN', gminaId: 'g1', invalid: false });
  });

  it('keeps the token valid on re-validation when nothing changed', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      lockedUntil: null,
      passwordChangedAt: new Date(0),
      role: 'VOLUNTEER',
      gminaId: null,
    } as any);

    const token = await jwt({ token: { sub: 'u1', iat: Math.floor(Date.now() / 1000) } } as any);

    expect(token.invalid).toBe(false);
  });

  it('invalidates the token when the account has been deactivated', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isActive: false,
      lockedUntil: null,
      passwordChangedAt: new Date(0),
      role: 'VOLUNTEER',
      gminaId: null,
    } as any);

    const token = await jwt({ token: { sub: 'u1', iat: Math.floor(Date.now() / 1000) } } as any);

    expect(token.invalid).toBe(true);
  });

  it('invalidates the token while the account is locked', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      lockedUntil: new Date(Date.now() + 60_000),
      passwordChangedAt: new Date(0),
      role: 'VOLUNTEER',
      gminaId: null,
    } as any);

    const token = await jwt({ token: { sub: 'u1', iat: Math.floor(Date.now() / 1000) } } as any);

    expect(token.invalid).toBe(true);
  });

  it('invalidates a session issued before a later password reset (anti session-hijack)', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      lockedUntil: null,
      passwordChangedAt: new Date(), // just now, after the token was issued
      role: 'VOLUNTEER',
      gminaId: null,
    } as any);

    const token = await jwt({ token: { sub: 'u1', iat: issuedAt } } as any);

    expect(token.invalid).toBe(true);
  });

  it('invalidates the token when the user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const token = await jwt({ token: { sub: 'deleted-user', iat: Math.floor(Date.now() / 1000) } } as any);

    expect(token.invalid).toBe(true);
  });
});

describe('session callback', () => {
  const session = authOptions.callbacks!.session!;

  it('strips session.user when the token is invalid', async () => {
    const result = await session({
      session: { user: { id: 'u1' }, expires: 'later' } as any,
      token: { invalid: true } as any,
    } as any);

    expect((result as any).user).toBeUndefined();
    expect((result as any).expires).toBe('later');
  });

  it('populates session.user from the token when valid', async () => {
    const result = await session({
      session: { user: {}, expires: 'later' } as any,
      token: { invalid: false, sub: 'u1', role: 'COORDINATOR', gminaId: 'g1' } as any,
    } as any);

    expect((result as any).user).toMatchObject({ id: 'u1', role: 'COORDINATOR', gminaId: 'g1' });
  });
});