import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return { ...actual, requireAdminOrCoordinator: vi.fn() };
});
// Auto-mocked: every export becomes a vi.fn() returning undefined, i.e. an
// always-miss cache / no-op set+invalidate, so these tests exercise the same
// mandatory-Postgres-read path as before this cache existed — without this,
// rejectEarlyIfDenied() would hit the real Redis client and leak state
// across tests.
vi.mock('@/lib/resourceAccessCache');

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { fakeCheckViolation } from '@/lib/__mocks__/prismaErrors';
import { GET, PATCH, DELETE } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

const baseResource = {
  id: 'r1',
  name: 'Koce',
  description: null,
  quantity: 10,
  unit: 'szt',
  status: 'AVAILABLE',
  categoryId: 'cat1',
  gminaId: 'g1',
  organizationId: 'o1',
  horizon: 'H24',
  location: null,
  reservedQuantity: 0,
};

function makeRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/resources/r1', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: { id: 'r1' } };

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('GET /api/resources/[id]', () => {
  it('returns 403 with no DB call when unauthenticated', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resource.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the resource does not exist', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resource.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(404);
  });

  it("rejects a COORDINATOR from a DIFFERENT organization", async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'other-org' });
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(403);
  });

  it('allows the owning organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });

  it('allows ADMIN regardless of organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);

    const res = await GET(makeRequest('GET'), ctx);

    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/resources/[id]', () => {
  // The snapshot said reservedQuantity 0, an allocation reserved 8 in the
  // meantime, and the owner shrinks quantity to 5 — the DB CHECK constraint
  // resource_reserved_within_quantity rejects it; must read as the same 409
  // the in-route reservedQuantity guard gives, not as a 500.
  it('maps a DB CHECK constraint violation on the shrink to 409', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });
    prisma.resource.findUnique.mockResolvedValue({ ...baseResource, reservedQuantity: 0 } as any);
    prisma.resource.update.mockRejectedValue(fakeCheckViolation('resource_reserved_within_quantity'));

    const res = await PATCH(makeRequest('PATCH', { quantity: 5 }), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('poniżej już zarezerwowanej');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a COORDINATOR from a different organization before validating the body', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'other-org' });
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);

    const res = await PATCH(makeRequest('PATCH', { name: 'Nowa nazwa' }), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resource.update).not.toHaveBeenCalled();
  });

  it('rejects an empty body', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);

    const res = await PATCH(makeRequest('PATCH', {}), ctx);

    expect(res.status).toBe(400);
    expect(prisma.resource.update).not.toHaveBeenCalled();
  });

  it('rejects shrinking quantity below reservedQuantity', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });
    prisma.resource.findUnique.mockResolvedValue({ ...baseResource, reservedQuantity: 5 } as any);

    const res = await PATCH(makeRequest('PATCH', { quantity: 3 }), ctx);

    expect(res.status).toBe(409);
    expect(prisma.resource.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown category', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.resourceCategory.findUnique.mockResolvedValue(null);

    const res = await PATCH(makeRequest('PATCH', { categoryId: 'bad' }), ctx);

    expect(res.status).toBe(400);
    expect(prisma.resource.update).not.toHaveBeenCalled();
  });

  it('updates the resource and records an audit entry', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.resource.update.mockResolvedValue({ ...baseResource, name: 'Nowa nazwa' } as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await PATCH(makeRequest('PATCH', { name: 'Nowa nazwa' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.resource.name).toBe('Nowa nazwa');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'RESOURCE_UPDATE', entityId: 'r1' }) })
    );
  });
});

describe('DELETE /api/resources/[id]', () => {
  it('rejects a COORDINATOR from a different organization', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'other-org' });
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);

    const res = await DELETE(makeRequest('DELETE'), ctx);

    expect(res.status).toBe(403);
    expect(prisma.resource.delete).not.toHaveBeenCalled();
  });

  it('rejects deletion with 409 when reservedQuantity > 0', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' });
    prisma.resource.findUnique.mockResolvedValue({ ...baseResource, reservedQuantity: 2 } as any);

    const res = await DELETE(makeRequest('DELETE'), ctx);

    expect(res.status).toBe(409);
    expect(prisma.resource.delete).not.toHaveBeenCalled();
  });

  it('deletes the resource and records an audit entry when unreserved', async () => {
    const user = { id: 'c1', role: 'COORDINATOR', gminaId: 'g1', organizationId: 'o1' };
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(user as any);
    prisma.resource.findUnique.mockResolvedValue(baseResource as any);
    prisma.resource.delete.mockResolvedValue(baseResource as any);
    prisma.auditLog.create.mockResolvedValue({} as any);

    const res = await DELETE(makeRequest('DELETE'), ctx);

    expect(res.status).toBe(200);
    expect(prisma.resource.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'RESOURCE_DELETE', entityId: 'r1' }) })
    );
  });
});
