import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');

import { prisma as prismaImport } from './prisma';
import { scopedOrganizationWhere, normalizeOrganizationName, createOrganization } from './organization';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

// Mirrors the scopedGminaWhere regression coverage in lib/gmina.test.ts: the
// fail-closed contract (null, never {}, for a scoped actor with no
// organization of their own) is exactly the same trap that bit the
// gmina-scoping code in the 2026-09-10 audit.
describe('scopedOrganizationWhere', () => {
  it('returns an unfiltered {} for ADMIN regardless of organizationId', () => {
    expect(scopedOrganizationWhere({ role: 'ADMIN', organizationId: null })).toEqual({});
    expect(scopedOrganizationWhere({ role: 'ADMIN', organizationId: 'org-1' })).toEqual({});
  });

  it('scopes COORDINATOR/VOLUNTEER to their own organization when they have one', () => {
    expect(scopedOrganizationWhere({ role: 'COORDINATOR', organizationId: 'org-1' })).toEqual({ organizationId: 'org-1' });
    expect(scopedOrganizationWhere({ role: 'VOLUNTEER', organizationId: 'org-2' })).toEqual({ organizationId: 'org-2' });
  });

  it('fails closed (returns null, never {}) for an organization-scoped role with no organization', () => {
    expect(scopedOrganizationWhere({ role: 'COORDINATOR', organizationId: null })).toBeNull();
    expect(scopedOrganizationWhere({ role: 'VOLUNTEER', organizationId: null })).toBeNull();
  });

  it('fails closed when organizationId is missing entirely (not just null)', () => {
    expect(scopedOrganizationWhere({ role: 'COORDINATOR' })).toBeNull();
  });
});

describe('normalizeOrganizationName', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeOrganizationName('  Caritas  ')).toBe('Caritas');
  });

  it('collapses internal runs of whitespace to a single space', () => {
    expect(normalizeOrganizationName('Polski   Czerwony Krzyż')).toBe('Polski Czerwony Krzyż');
  });
});

describe('createOrganization', () => {
  beforeEach(() => {
    mockReset(prisma);
  });

  it('rejects a blank name without touching the database', async () => {
    const result = await createOrganization({ name: '   ', gminaId: 'g1' });

    expect(result).toEqual({ error: 'Nazwa organizacji jest wymagana.' });
    expect(prisma.gmina.findUnique).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('rejects a missing gminaId without touching the database', async () => {
    const result = await createOrganization({ name: 'Caritas', gminaId: '' });

    expect(result).toEqual({ error: 'Gmina jest wymagana.' });
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('errors when the given gminaId does not exist', async () => {
    prisma.gmina.findUnique.mockResolvedValue(null);

    const result = await createOrganization({ name: 'Caritas', gminaId: 'missing' });

    expect(result).toEqual({ error: 'Wybrana gmina nie istnieje.' });
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('creates a new organization when no case/whitespace-insensitive (name, gmina) match exists', async () => {
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({ id: 'o1', name: 'Caritas', gminaId: 'g1' } as any);

    const result = await createOrganization({ name: '  Caritas  ', gminaId: 'g1' });

    expect(result).toEqual({ organization: { id: 'o1', name: 'Caritas', gminaId: 'g1' }, created: true });
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: { gminaId: 'g1', name: { equals: 'Caritas', mode: 'insensitive' } },
    });
    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: { name: 'Caritas', gmina: { connect: { id: 'g1' } } },
    });
  });

  it('reuses an existing organization in the SAME gmina instead of creating a duplicate when only case differs', async () => {
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockResolvedValue({ id: 'existing-1', name: 'Caritas', gminaId: 'g1' } as any);

    const result = await createOrganization({ name: 'CARITAS', gminaId: 'g1' });

    expect(result).toEqual({ organization: { id: 'existing-1', name: 'Caritas', gminaId: 'g1' }, created: false });
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('does NOT reuse a same-named organization from a DIFFERENT gmina — name uniqueness is scoped per gmina', async () => {
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g2' } as any);
    // findFirst is itself scoped by gminaId in the where clause, so a
    // same-named org in a different gmina is correctly never returned here —
    // this test documents that expectation via the call arguments.
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({ id: 'o2', name: 'Caritas', gminaId: 'g2' } as any);

    await createOrganization({ name: 'Caritas', gminaId: 'g2' });

    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: { gminaId: 'g2', name: { equals: 'Caritas', mode: 'insensitive' } },
    });
  });

  it('passes through optional address/contact fields when creating', async () => {
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({ id: 'o1', name: 'Caritas', gminaId: 'g1' } as any);

    await createOrganization({
      name: 'Caritas',
      gminaId: 'g1',
      street: 'Długa',
      houseNumber: '12',
      city: 'Kraków',
      postalCode: '30-001',
      contactFirstName: 'Jan',
      contactLastName: 'Kowalski',
      contactPhone: '+48 600 100 200',
      contactEmail: 'jan@example.com',
    });

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: {
        name: 'Caritas',
        gmina: { connect: { id: 'g1' } },
        street: 'Długa',
        houseNumber: '12',
        city: 'Kraków',
        postalCode: '30-001',
        contactFirstName: 'Jan',
        contactLastName: 'Kowalski',
        contactPhone: '+48 600 100 200',
        contactEmail: 'jan@example.com',
      },
    });
  });

  it('passes through apartmentNumber when creating', async () => {
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({ id: 'o1', name: 'Caritas', gminaId: 'g1' } as any);

    await createOrganization({
      name: 'Caritas',
      gminaId: 'g1',
      apartmentNumber: '3A',
    });

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: {
        name: 'Caritas',
        gmina: { connect: { id: 'g1' } },
        apartmentNumber: '3A',
      },
    });
  });

  it('returns a clean error instead of throwing when the duplicate-check read itself fails', async () => {
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst.mockRejectedValue(new Error('connection lost'));

    const result = await createOrganization({ name: 'Caritas', gminaId: 'g1' });

    expect(result).toEqual({ error: 'Nie udało się utworzyć organizacji.' });
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('recovers by looking up the existing row on a race (unique constraint violation)', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    prisma.organization.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'race-1', name: 'Caritas', gminaId: 'g1' } as any);
    prisma.organization.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      })
    );

    const result = await createOrganization({ name: 'Caritas', gminaId: 'g1' });

    expect(result).toEqual({ organization: { id: 'race-1', name: 'Caritas', gminaId: 'g1' }, created: false });
  });

  it('returns a clean error instead of throwing when verifying the gmina itself fails', async () => {
    prisma.gmina.findUnique.mockRejectedValue(new Error('connection lost'));

    const result = await createOrganization({ name: 'Caritas', gminaId: 'g1' });

    expect(result).toEqual({ error: 'Nie udało się zweryfikować gminy.' });
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('falls through to a generic error when a P2002 race is not actually a name collision (row not found on recheck)', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);
    // Both the initial check AND the post-race recheck find nothing — the
    // P2002 must have been caused by something other than the (name, gminaId)
    // collision this function is written to recover from.
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      })
    );

    const result = await createOrganization({ name: 'Caritas', gminaId: 'g1' });

    expect(result).toEqual({ error: 'Nie udało się utworzyć organizacji.' });
  });
});
