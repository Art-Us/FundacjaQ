import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');

import { prisma as prismaImport } from './prisma';
import { normalizeOrganizationName, createOrganization } from './organization';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

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
});
