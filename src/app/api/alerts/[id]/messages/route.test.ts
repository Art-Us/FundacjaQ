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

const baseAlert = { id: 'a1', gminaId: 'g1', organizationId: 'owner-org' };

function makeRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/alerts/a1/messages', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'a1' } };
const validEntry = { type: 'STAFF_COMMUNIQUE', title: 'Sytuacja pod kontrolą', body: 'Treść wpisu.' };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireUser).mockReset();
});

describe('GET /api/alerts/[id]/messages', () => {
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
    expect(prisma.alertMessage.findMany).not.toHaveBeenCalled();
  });

  it('allows a VOLUNTEER from the same gmina (read-only forum visibility)', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'v1', role: 'VOLUNTEER', gminaId: 'g1', organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
    expect(prisma.alertMessage.findMany).toHaveBeenCalledWith({
      where: { alertId: 'a1', parentId: null },
      include: {
        author: { select: { id: true, name: true } },
        _count: { select: { replies: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('allows ADMIN regardless of gmina', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/alerts/[id]/messages', () => {
  it('rejects a VOLUNTEER even from the same gmina — only ADMIN/COORDINATOR run the journal', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'v1', role: 'VOLUNTEER', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', validEntry), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertMessage.create).not.toHaveBeenCalled();
  });

  it('rejects a COORDINATOR from a different gmina', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g2', organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', validEntry), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertMessage.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid type', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', { ...validEntry, type: 'NOT_A_TYPE' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alertMessage.create).not.toHaveBeenCalled();
  });

  it('rejects an empty title', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', { ...validEntry, title: '' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alertMessage.create).not.toHaveBeenCalled();
  });

  it('creates a root entry for a COORDINATOR in the same gmina', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'coord-org' };
    vi.mocked(requireUser).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.create.mockResolvedValue({ id: 'msg1', ...validEntry } as any);

    const res = await POST(makeRequest('POST', validEntry), ctx);
    const responseBody = await res.json();

    expect(res.status).toBe(201);
    expect(responseBody.entry.id).toBe('msg1');
    expect(prisma.alertMessage.create).toHaveBeenCalledWith({
      data: {
        alertId: 'a1',
        authorId: 'c1',
        authorOrgId: 'coord-org',
        type: validEntry.type,
        title: validEntry.title,
        body: validEntry.body,
      },
      include: { author: { select: { id: true, name: true } } },
    });
  });

  it('allows ADMIN to post a root entry even without an organization', async () => {
    const user = { id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null };
    vi.mocked(requireUser).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertMessage.create.mockResolvedValue({ id: 'msg1' } as any);

    const res = await POST(makeRequest('POST', validEntry), ctx);

    expect(res.status).toBe(201);
  });
});
