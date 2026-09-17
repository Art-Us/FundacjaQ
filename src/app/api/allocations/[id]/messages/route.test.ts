import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdminOrCoordinator: vi.fn() };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { GET, POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const baseAllocation = {
  id: 'alloc1',
  donorOrgId: 'donor-org',
  alert: { id: 'a1', organizationId: 'owner-org' },
};

function makeRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/allocations/alloc1/messages', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'alloc1' } };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('GET /api/allocations/[id]/messages', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resourceAllocation.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the allocation does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resourceAllocation.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a COORDINATOR from an unrelated third organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'unrelated-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.allocationMessage.findMany).not.toHaveBeenCalled();
  });

  it('allows the donor organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.allocationMessage.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });

  it('allows the recipient organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.allocationMessage.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });

  it('allows ADMIN regardless of organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.allocationMessage.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/allocations/[id]/messages', () => {
  it('rejects a COORDINATOR from an unrelated third organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'unrelated-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await POST(makeRequest('POST', { body: 'Kiedy dowóz?' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.allocationMessage.create).not.toHaveBeenCalled();
  });

  it('rejects an empty message body', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);

    const res = await POST(makeRequest('POST', { body: '' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.allocationMessage.create).not.toHaveBeenCalled();
  });

  it('creates a message from the donor organization', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.allocationMessage.create.mockResolvedValue({
      id: 'msg1',
      allocationId: 'alloc1',
      authorId: 'c1',
      body: 'Kiedy dowóz?',
    } as any);

    const res = await POST(makeRequest('POST', { body: 'Kiedy dowóz?' }), ctx);
    const responseBody = await res.json();

    expect(res.status).toBe(201);
    expect(responseBody.message.id).toBe('msg1');
    expect(prisma.allocationMessage.create).toHaveBeenCalledWith({
      data: { allocationId: 'alloc1', authorId: 'c1', body: 'Kiedy dowóz?' },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  });

  it('allows ADMIN to post a message even without an organization', async () => {
    const user = { id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resourceAllocation.findUnique.mockResolvedValue(baseAllocation as any);
    prisma.allocationMessage.create.mockResolvedValue({ id: 'msg1' } as any);

    const res = await POST(makeRequest('POST', { body: 'Status?' }), ctx);

    expect(res.status).toBe(201);
  });
});
