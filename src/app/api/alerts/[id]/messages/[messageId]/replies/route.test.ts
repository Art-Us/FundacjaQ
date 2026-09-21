import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireUser: vi.fn() };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireUser } from '@/lib/authz';
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const baseAlert = {
  id: 'a1',
  gminaId: 'g1',
  organizationId: 'owner-org',
  allocations: [{ donorOrgId: 'donor-org' }],
};
const rootEntry = { id: 'msg1' };

function makeRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/alerts/a1/messages/msg1/replies', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'a1', messageId: 'msg1' } };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireUser).mockReset();
});

describe('GET /api/alerts/[id]/messages/[messageId]/replies', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireUser).mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the alert does not exist', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a VOLUNTEER from a different gmina', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'v1', role: 'VOLUNTEER', gminaId: 'g2' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertMessage.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when messageId is not a root entry of this alert', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'v1', role: 'VOLUNTEER', gminaId: 'g1' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findFirst.mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(404);
    expect(prisma.alertMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'msg1', alertId: 'a1', parentId: null },
      select: { id: true },
    });
    expect(prisma.alertMessage.findMany).not.toHaveBeenCalled();
  });

  it('allows a VOLUNTEER from the same gmina to read the thread', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'v1', role: 'VOLUNTEER', gminaId: 'g1' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findFirst.mockResolvedValue(rootEntry as any);
    prisma.alertMessage.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
    expect(prisma.alertMessage.findMany).toHaveBeenCalledWith({
      where: { parentId: 'msg1' },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  });
});

describe('POST /api/alerts/[id]/messages/[messageId]/replies', () => {
  it('rejects a VOLUNTEER from an unrelated organization', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'v1', role: 'VOLUNTEER', gminaId: 'g1', organizationId: 'unrelated-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', { body: 'Dzięki!' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertMessage.create).not.toHaveBeenCalled();
  });

  it('returns 404 when messageId is not a root entry of this alert', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest('POST', { body: 'Dzięki!' }), ctx);

    expect(res.status).toBe(404);
    expect(prisma.alertMessage.create).not.toHaveBeenCalled();
  });

  it('rejects an empty reply body', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findFirst.mockResolvedValue(rootEntry as any);

    const res = await POST(makeRequest('POST', { body: '' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alertMessage.create).not.toHaveBeenCalled();
  });

  it('allows the alert owner organization to reply', async () => {
    const user = { id: 'v1', role: 'VOLUNTEER', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireUser).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findFirst.mockResolvedValue(rootEntry as any);
    prisma.alertMessage.create.mockResolvedValue({ id: 'reply1', body: 'Dzięki!' } as any);

    const res = await POST(makeRequest('POST', { body: 'Dzięki!' }), ctx);
    const responseBody = await res.json();

    expect(res.status).toBe(201);
    expect(responseBody.reply.id).toBe('reply1');
    expect(prisma.alertMessage.create).toHaveBeenCalledWith({
      data: { alertId: 'a1', parentId: 'msg1', authorId: 'v1', authorOrgId: 'owner-org', body: 'Dzięki!' },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  });

  it('allows a donor organization to reply', async () => {
    const user = { id: 'v2', role: 'VOLUNTEER', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireUser).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findFirst.mockResolvedValue(rootEntry as any);
    prisma.alertMessage.create.mockResolvedValue({ id: 'reply2' } as any);

    const res = await POST(makeRequest('POST', { body: 'Jesteśmy w drodze.' }), ctx);

    expect(res.status).toBe(201);
  });

  it('allows ADMIN/COORDINATOR to reply regardless of organization', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: null };
    vi.mocked(requireUser).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findFirst.mockResolvedValue(rootEntry as any);
    prisma.alertMessage.create.mockResolvedValue({ id: 'reply3' } as any);

    const res = await POST(makeRequest('POST', { body: 'Status?' }), ctx);

    expect(res.status).toBe(201);
  });
});
