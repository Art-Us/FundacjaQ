import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/rateLimit', () => ({
  consumeLimit: vi.fn(),
  passwordResetLimiter: {},
  passwordResetPerAccountLimiter: {},
}));
vi.mock('@/lib/email', () => ({
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('@/lib/attemptTracker', () => ({
  getAttemptCount: vi.fn(),
  recordAttempt: vi.fn(),
}));
vi.mock('@/lib/captcha', () => ({
  verifyCaptcha: vi.fn(),
}));
vi.mock('@/lib/ipLockout', () => ({
  checkIpBlock: vi.fn(),
  IP_BLOCKED_MESSAGE: 'Zbyt wiele nieudanych prób logowania z tego adresu IP. Spróbuj ponownie później.',
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { consumeLimit } from '@/lib/rateLimit';
import { sendPasswordResetEmail } from '@/lib/email';
import { getAttemptCount, recordAttempt } from '@/lib/attemptTracker';
import { verifyCaptcha } from '@/lib/captcha';
import { checkIpBlock } from '@/lib/ipLockout';
import { POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(consumeLimit).mockReset().mockResolvedValue(true);
  vi.mocked(sendPasswordResetEmail).mockReset().mockResolvedValue(undefined);
  vi.mocked(getAttemptCount).mockReset().mockResolvedValue(0);
  vi.mocked(recordAttempt).mockReset().mockResolvedValue(undefined as any);
  vi.mocked(verifyCaptcha).mockReset().mockResolvedValue(true);
  vi.mocked(checkIpBlock).mockReset().mockResolvedValue({ blocked: false, until: null });
});

describe('POST /api/auth/forgot-password', () => {
  it('returns the same generic response for an existing active user, a nonexistent email, and an inactive user (no enumeration)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'user@example.com',
      isActive: true,
    } as any);
    const existing = await POST(makeRequest({ email: 'user@example.com' }));
    const existingBody = await existing.json();

    prisma.user.findUnique.mockResolvedValueOnce(null);
    const nonexistent = await POST(makeRequest({ email: 'nobody@example.com' }));
    const nonexistentBody = await nonexistent.json();

    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u2', email: 'inactive@example.com', isActive: false } as any);
    const inactive = await POST(makeRequest({ email: 'inactive@example.com' }));
    const inactiveBody = await inactive.json();

    expect(existing.status).toBe(200);
    expect(nonexistent.status).toBe(200);
    expect(inactive.status).toBe(200);
    expect(existingBody).toEqual(nonexistentBody);
    expect(existingBody).toEqual(inactiveBody);
  });

  it('creates a reset token and sends an email only for an existing active user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com', isActive: true } as any);
    prisma.passwordResetToken.create.mockResolvedValue({} as any);

    await POST(makeRequest({ email: 'user@example.com' }));

    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith('user@example.com', expect.stringContaining('/reset-password/'));
  });

  it('does not create a token for a nonexistent email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await POST(makeRequest({ email: 'nobody@example.com' }));

    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with 400 and touches no database', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a missing email field with 400', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('accepts an explicit null captchaToken (what the client actually sends before captcha is required)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com', isActive: true } as any);

    const res = await POST(makeRequest({ email: 'user@example.com', captchaToken: null }));

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });

  it('still returns the generic message (not a distinguishable status) when rate-limited', async () => {
    vi.mocked(consumeLimit).mockResolvedValue(false);

    const res = await POST(makeRequest({ email: 'user@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain('Jeśli podany adres istnieje');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('checks both the per-IP+email limit and a separate email-only limit (so rotating IPs cannot bypass it)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com', isActive: true } as any);

    await POST(makeRequest({ email: 'user@example.com' }));

    expect(consumeLimit).toHaveBeenCalledWith(expect.anything(), 'user@example.com:1.2.3.4');
    expect(consumeLimit).toHaveBeenCalledWith(expect.anything(), 'user@example.com');
  });

  it('blocks and returns the generic message when only the email-only limit is exhausted', async () => {
    vi.mocked(consumeLimit).mockImplementation(async (_limiter, key: string) => key.includes(':'));

    const res = await POST(makeRequest({ email: 'user@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain('Jeśli podany adres istnieje');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('captcha gate', () => {
  it('does not require captcha below the attempt thresholds', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com', isActive: true } as any);

    await POST(makeRequest({ email: 'user@example.com' }));

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it('requires captcha once the account has made enough recent requests', async () => {
    vi.mocked(getAttemptCount).mockImplementation(async (scope: string) => (scope === 'pwd-reset-account' ? 2 : 0));
    vi.mocked(verifyCaptcha).mockResolvedValue(false);

    const res = await POST(makeRequest({ email: 'user@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.captchaRequired).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('requires captcha once the IP alone has made enough recent requests', async () => {
    vi.mocked(getAttemptCount).mockImplementation(async (scope: string) => (scope === 'pwd-reset-ip' ? 3 : 0));
    vi.mocked(verifyCaptcha).mockResolvedValue(false);

    const res = await POST(makeRequest({ email: 'user@example.com' }));
    const body = await res.json();

    expect(body.captchaRequired).toBe(true);
  });

  it('proceeds with a valid captcha token once required', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'user@example.com', isActive: true } as any);
    vi.mocked(getAttemptCount).mockImplementation(async (scope: string) => (scope === 'pwd-reset-account' ? 2 : 0));
    vi.mocked(verifyCaptcha).mockResolvedValue(true);

    const res = await POST(makeRequest({ email: 'user@example.com', captchaToken: 'valid-token' }));

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalled();
    expect(verifyCaptcha).toHaveBeenCalledWith('valid-token', '1.2.3.4');
  });

  it('records an attempt on every request regardless of outcome', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await POST(makeRequest({ email: 'nobody@example.com' }));

    expect(recordAttempt).toHaveBeenCalledWith('pwd-reset-account', 'nobody@example.com');
    expect(recordAttempt).toHaveBeenCalledWith('pwd-reset-ip', '1.2.3.4');
  });
});

describe('IP lockout', () => {
  it('rejects with 429 before touching the database when the IP is escalating-blocked', async () => {
    vi.mocked(checkIpBlock).mockResolvedValue({ blocked: true, until: new Date(Date.now() + 60_000) });

    const res = await POST(makeRequest({ email: 'user@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toContain('adresu IP');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(consumeLimit).not.toHaveBeenCalled();
  });
});