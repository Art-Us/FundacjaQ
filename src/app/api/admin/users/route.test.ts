import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return {
    ...actual,
    requireAdmin: vi.fn(),
  };
});
vi.mock('@/lib/password', async () => {
  const actual = await vi.importActual<typeof import('@/lib/password')>('@/lib/password');
  return {
    ...actual,
    hashPassword: vi.fn(),
    isPasswordPwned: vi.fn(),
  };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdmin } from '@/lib/authz';
import { hashPassword, isPasswordPwned } from '@/lib/password';
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const STRONG_PASSWORD = 'CorrectHorseBattery9!';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(hashPassword).mockReset().mockResolvedValue('hashed');
  vi.mocked(isPasswordPwned).mockReset().mockResolvedValue(false);
});

describe('GET /api/admin/users', () => {
  it('returns 403 with no DB call when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('returns the user list for an ADMIN session', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }] as any);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users).toHaveLength(1);
  });
});

describe('POST /api/admin/users', () => {
  it('rejects with 403 and no DB write when the caller is not an ADMIN', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);

    const res = await POST(makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER' }));

    expect(res.status).toBe(403);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates the user as inactive, hashing the password', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'new-1' } as any);

    const res = await POST(
      makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER', gminaId: 'g1' })
    );

    expect(res.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@example.com',
          passwordHash: 'hashed',
          role: 'VOLUNTEER',
          gminaId: 'g1',
          isActive: false,
        }),
      })
    );
  });

  it('rejects a duplicate email with 400 and does not create a user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' } as any);

    const res = await POST(makeRequest({ email: 'existing@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER' }));

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a password found in a breach database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(isPasswordPwned).mockResolvedValue(true);

    const res = await POST(makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'VOLUNTEER' }));

    expect(res.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a role outside the enum before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ email: 'new@example.com', password: STRONG_PASSWORD, role: 'SUPERADMIN' }));

    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a weak password before touching the database', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest({ email: 'new@example.com', password: 'short1!', role: 'VOLUNTEER' }));

    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
