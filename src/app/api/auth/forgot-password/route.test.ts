import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/rateLimit', () => ({
  consumeLimit: vi.fn(),
  passwordResetLimiter: {},
}));
vi.mock('@/lib/email', () => ({
  sendPasswordResetEmail: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { consumeLimit } from '@/lib/rateLimit';
import { sendPasswordResetEmail } from '@/lib/email';
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

  it('still returns the generic message (not a distinguishable status) when rate-limited', async () => {
    vi.mocked(consumeLimit).mockResolvedValue(false);

    const res = await POST(makeRequest({ email: 'user@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain('Jeśli podany adres istnieje');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
