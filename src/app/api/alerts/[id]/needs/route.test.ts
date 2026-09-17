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

const baseAlert = { id: 'a1', gminaId: 'g1', organizationId: 'owner-org' };

function makeRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/alerts/a1/needs', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'a1' } };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('GET /api/alerts/[id]/needs', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alert.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the alert does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(404);
  });

  it('rejects a COORDINATOR from a different gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'other-gmina' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertNeed.findMany).not.toHaveBeenCalled();
  });

  it('allows a COORDINATOR from the same gmina, even a different organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });

  it('allows ADMIN regardless of gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.alertNeed.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/alerts/[id]/needs', () => {
  it('rejects with 403 and no DB write when the caller is not ADMIN/COORDINATOR', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await POST(makeRequest('POST', { categoryId: 'c1', title: 'Koce', quantityNeeded: 5 }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertNeed.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the alert does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest('POST', { categoryId: 'c1', title: 'Koce', quantityNeeded: 5 }), ctx);

    expect(res.status).toBe(404);
  });

  it("rejects a COORDINATOR whose organization does NOT own the alert", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'donor-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', { categoryId: 'c1', title: 'Koce', quantityNeeded: 5 }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.alertNeed.create).not.toHaveBeenCalled();
  });

  it('rejects a missing title before touching the database', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', { categoryId: 'c1', quantityNeeded: 5 }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.resourceCategory.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a zero/negative quantityNeeded', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);

    const res = await POST(makeRequest('POST', { categoryId: 'c1', title: 'Koce', quantityNeeded: 0 }), ctx);

    expect(res.status).toBe(400);
  });

  it('rejects an unknown category', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' });
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceCategory.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest('POST', { categoryId: 'bad', title: 'Koce', quantityNeeded: 5 }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.alertNeed.create).not.toHaveBeenCalled();
  });

  it("creates a need for the alert owner organization and records an audit entry", async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'owner-org' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceCategory.findUnique.mockResolvedValue({ id: 'cat1' } as any);
    prisma.alertNeed.create.mockResolvedValue({
      id: 'need1',
      alertId: 'a1',
      categoryId: 'cat1',
      title: 'Koce',
      description: null,
      quantityNeeded: 5,
      quantityFulfilled: 0,
      unit: 'szt',
      urgency: 'NORMAL',
      status: 'OPEN',
    } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest('POST', { categoryId: 'cat1', title: 'Koce', quantityNeeded: 5 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.need.id).toBe('need1');
    expect(prisma.alertNeed.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ alertId: 'a1', categoryId: 'cat1', title: 'Koce', quantityNeeded: 5, createdById: 'c1' }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ALERT_NEED_CREATE', entityType: 'ALERT_NEED', entityId: 'need1' }) })
    );
  });

  it('allows ADMIN to create a need even for an alert owned by another organization', async () => {
    const user = { id: 'admin-1', role: 'ADMIN', gminaId: null, organizationId: null };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.alert.findUnique.mockResolvedValue(baseAlert as any);
    prisma.resourceCategory.findUnique.mockResolvedValue({ id: 'cat1' } as any);
    prisma.alertNeed.create.mockResolvedValue({ id: 'need1' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await POST(makeRequest('POST', { categoryId: 'cat1', title: 'Koce', quantityNeeded: 5 }), ctx);

    expect(res.status).toBe(201);
  });
});
