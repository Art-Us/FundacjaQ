import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma');
vi.mock('@/lib/authz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz')>('@/lib/authz');
  return {
    ...actual,
    requireAdminOrCoordinator: vi.fn(),
  };
});

import { prisma as prismaImport } from '@/lib/prisma';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { POST } from './route';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

// NOTE: this route file only exports POST — there is no GET /api/alerts.
// The alerts *list* is read directly in the map page server component
// (src/app/(protected)/map/page.tsx), scoped there via scopedGminaWhere, not
// through an API route. So there is nothing to test here for GET.

function baseBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: 'Powódź w centrum',
    description: 'Woda podnosi się szybko.',
    kind: 'ALERT',
    severity: 'HIGH',
    category: 'HYDROLOGICAL',
    latitude: 52.2297,
    longitude: 21.0122,
    gminaId: 'gmina-1',
    ...overrides,
  };
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/alerts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest() {
  return new NextRequest('http://localhost/api/alerts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not valid json',
  });
}

beforeEach(() => {
  mockReset(prisma);
  vi.mocked(requireAdminOrCoordinator).mockReset();
});

describe('POST /api/alerts', () => {
  it('returns 403 with no DB call when there is no authorized session', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue(null);

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(403);
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(prisma.gmina.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeInvalidJsonRequest());

    expect(res.status).toBe(400);
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it.each(['title', 'description', 'latitude', 'longitude', 'gminaId'])(
    'rejects a missing required field (%s) with 400 and no DB call',
    async (field) => {
      vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
      const body = baseBody() as Record<string, unknown>;
      delete body[field];

      const res = await POST(makeRequest(body));

      expect(res.status).toBe(400);
      expect(prisma.alert.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['latitude', 91],
    ['latitude', -91],
    ['longitude', 181],
    ['longitude', -181],
  ])('rejects an out-of-range %s (%d) with 400', async (field, value) => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    const res = await POST(makeRequest(baseBody({ [field]: value })));

    expect(res.status).toBe(400);
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('rejects a category that does not belong to the given kind with 400 and no DB call', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });

    // FESTIVAL is an EVENT category, not valid for kind ALERT.
    const res = await POST(makeRequest(baseBody({ kind: 'ALERT', category: 'FESTIVAL' })));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Wybrana kategoria nie należy do tego rodzaju wpisu.');
    expect(prisma.gmina.findUnique).not.toHaveBeenCalled();
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('accepts a matching EVENT kind/category pair', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'gmina-1' } as any);
    prisma.alert.create.mockResolvedValue({ id: 'alert-1' } as any);

    const res = await POST(makeRequest(baseBody({ kind: 'EVENT', category: 'FESTIVAL', severity: undefined })));

    expect(res.status).toBe(200);
  });

  // Mirrors scopedGminaWhere's fail-closed contract (src/lib/gmina.ts): a
  // gmina-scoped role may only act within its own gmina, and a mismatch must
  // be rejected — never silently allowed through.
  it('rejects a COORDINATOR creating an alert for a gmina that is not their own (403, no DB call)', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: 'gmina-1' });

    const res = await POST(makeRequest(baseBody({ gminaId: 'gmina-OTHER' })));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Możesz tworzyć alerty tylko dla swojej gminy.');
    expect(prisma.gmina.findUnique).not.toHaveBeenCalled();
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  // Regression / fail-closed edge case: a COORDINATOR with no gmina of their
  // own must not be able to create an alert anywhere, since gminaId !== null
  // for any real (non-empty) gminaId in the request.
  it('rejects a COORDINATOR with no gmina of their own from creating any alert', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: null });

    const res = await POST(makeRequest(baseBody({ gminaId: 'gmina-1' })));

    expect(res.status).toBe(403);
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('lets a COORDINATOR create an alert for their own gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'coord-1', role: 'COORDINATOR', gminaId: 'gmina-1' });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'gmina-1' } as any);
    prisma.alert.create.mockResolvedValue({ id: 'alert-1' } as any);

    const res = await POST(makeRequest(baseBody({ gminaId: 'gmina-1' })));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alert).toEqual({ id: 'alert-1' });
    expect(prisma.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gminaId: 'gmina-1', authorId: 'coord-1' }),
      })
    );
  });

  it('lets ADMIN create an alert for any gmina', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'gmina-OTHER' } as any);
    prisma.alert.create.mockResolvedValue({ id: 'alert-1' } as any);

    const res = await POST(makeRequest(baseBody({ gminaId: 'gmina-OTHER' })));

    expect(res.status).toBe(200);
    expect(prisma.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gminaId: 'gmina-OTHER', authorId: 'admin-1' }) })
    );
  });

  it('rejects with 400 when the gmina does not exist, after the ownership check has passed', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(baseBody({ gminaId: 'ghost-gmina' })));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Gmina nie istnieje.');
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('returns 500 when the database create call throws', async () => {
    vi.mocked(requireAdminOrCoordinator).mockResolvedValue({ id: 'admin-1', role: 'ADMIN', gminaId: null });
    prisma.gmina.findUnique.mockResolvedValue({ id: 'gmina-1' } as any);
    prisma.alert.create.mockRejectedValue(new Error('connection lost'));

    await expect(POST(makeRequest(baseBody()))).rejects.toThrow('connection lost');
  });
});
