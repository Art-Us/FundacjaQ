import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/rateLimit', () => ({
  consumeLimit: vi.fn(),
  inviteCreateLimiter: {},
}));
vi.mock('@/lib/email', () => ({
  sendInviteEmail: vi.fn(),
}));
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma as prismaImport } from '@/lib/prisma';
import { consumeLimit } from '@/lib/rateLimit';
import { sendInviteEmail } from '@/lib/email';
import { getServerSession } from 'next-auth';
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockSession(role: string | null, id = 'session-user') {
  vi.mocked(getServerSession).mockResolvedValue(role ? ({ user: { id, role } } as any) : null);
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(consumeLimit).mockReset().mockResolvedValue(true);
  vi.mocked(sendInviteEmail).mockReset().mockResolvedValue(undefined);
  vi.mocked(getServerSession).mockReset();
});

describe('GET /api/admin/invites', () => {
  it('returns 403 with no DB call when there is no session', async () => {
    mockSession(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(prisma.inviteToken.findMany).not.toHaveBeenCalled();
  });

  it('returns 403 for a VOLUNTEER session', async () => {
    mockSession('VOLUNTEER');
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns invites for an ADMIN session', async () => {
    mockSession('ADMIN');
    prisma.inviteToken.findMany.mockResolvedValue([{ id: 'i1' }] as any);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.invites).toHaveLength(1);
  });
});

describe('POST /api/admin/invites', () => {
  it('rejects with 403 and no DB write when there is no session', async () => {
    mockSession(null);
    const res = await POST(makeRequest({ email: 'new@example.com', role: 'VOLUNTEER' }));
    expect(res.status).toBe(403);
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('lets ADMIN create an invite for any role, including ADMIN', async () => {
    mockSession('ADMIN', 'admin-1');
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.inviteToken.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest({ email: 'new-admin@example.com', role: 'ADMIN' }));

    expect(res.status).toBe(200);
    expect(prisma.inviteToken.create).toHaveBeenCalledTimes(1);
    expect(sendInviteEmail).toHaveBeenCalled();
  });

  it('blocks COORDINATOR from granting ADMIN or COORDINATOR roles', async () => {
    mockSession('COORDINATOR', 'coord-1');

    const adminAttempt = await POST(makeRequest({ email: 'x@example.com', role: 'ADMIN' }));
    const coordAttempt = await POST(makeRequest({ email: 'y@example.com', role: 'COORDINATOR' }));

    expect(adminAttempt.status).toBe(403);
    expect(coordAttempt.status).toBe(403);
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('lets COORDINATOR create a VOLUNTEER invite', async () => {
    mockSession('COORDINATOR', 'coord-1');
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.inviteToken.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest({ email: 'vol@example.com', role: 'VOLUNTEER' }));

    expect(res.status).toBe(200);
  });

  it('never stores the raw token — the stored tokenHash differs from the token in the emailed URL', async () => {
    mockSession('ADMIN', 'admin-1');
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.inviteToken.create.mockResolvedValue({} as any);

    await POST(makeRequest({ email: 'new@example.com', role: 'VOLUNTEER' }));

    const createCall = prisma.inviteToken.create.mock.calls[0][0] as any;
    const emailedUrl = vi.mocked(sendInviteEmail).mock.calls[0][1] as string;
    const rawTokenInUrl = emailedUrl.split('/invite/')[1];

    expect(createCall.data.tokenHash).not.toBe(rawTokenInUrl);
  });

  it('rejects a duplicate email with 400 and does not create a token', async () => {
    mockSession('ADMIN');
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' } as any);

    const res = await POST(makeRequest({ email: 'existing@example.com', role: 'VOLUNTEER' }));

    expect(res.status).toBe(400);
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });

  it('rejects a role outside the enum before any permission check (privilege-escalation probe)', async () => {
    mockSession('COORDINATOR');

    const res = await POST(makeRequest({ email: 'x@example.com', role: 'SUPERADMIN' }));

    expect(res.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-user invite-create rate limit is exceeded', async () => {
    mockSession('ADMIN');
    vi.mocked(consumeLimit).mockResolvedValue(false);

    const res = await POST(makeRequest({ email: 'x@example.com', role: 'VOLUNTEER' }));

    expect(res.status).toBe(429);
    expect(prisma.inviteToken.create).not.toHaveBeenCalled();
  });
});
