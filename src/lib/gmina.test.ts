import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');

import { prisma as prismaImport } from './prisma';
import { requiresGmina, scopedGminaWhere, normalizeGminaName, createGmina } from './gmina';

const prisma = prismaImport as unknown as DeepMockProxy<PrismaClient>;

describe('requiresGmina', () => {
  it('is false for ADMIN', () => {
    expect(requiresGmina('ADMIN')).toBe(false);
  });

  it('is true for COORDINATOR and VOLUNTEER', () => {
    expect(requiresGmina('COORDINATOR')).toBe(true);
    expect(requiresGmina('VOLUNTEER')).toBe(true);
  });
});

// Regression coverage for the 2026-09-10 audit finding: admin/invites/page.tsx,
// admin/users/page.tsx and lib/dashboard.ts all used to compute their gmina
// filter as `isAdmin || !actor.gminaId ? {} : { gminaId: actor.gminaId }`.
// For a gmina-scoped actor (COORDINATOR/VOLUNTEER) with no gmina of their
// own, that fell through to the *unfiltered* `{}` branch — handing them the
// same unrestricted, all-gminy view as an ADMIN. scopedGminaWhere replaces
// that pattern and must fail closed (return null, meaning "show nothing")
// in exactly that case.
describe('scopedGminaWhere', () => {
  it('returns an unfiltered {} for ADMIN regardless of gminaId', () => {
    expect(scopedGminaWhere({ role: 'ADMIN', gminaId: null })).toEqual({});
    expect(scopedGminaWhere({ role: 'ADMIN', gminaId: 'gmina-1' })).toEqual({});
  });

  it('scopes COORDINATOR/VOLUNTEER to their own gmina when they have one', () => {
    expect(scopedGminaWhere({ role: 'COORDINATOR', gminaId: 'gmina-1' })).toEqual({ gminaId: 'gmina-1' });
    expect(scopedGminaWhere({ role: 'VOLUNTEER', gminaId: 'gmina-2' })).toEqual({ gminaId: 'gmina-2' });
  });

  it('fails closed (returns null, never {}) for a gmina-scoped role with no gmina', () => {
    expect(scopedGminaWhere({ role: 'COORDINATOR', gminaId: null })).toBeNull();
    expect(scopedGminaWhere({ role: 'VOLUNTEER', gminaId: null })).toBeNull();
  });
});

describe('normalizeGminaName', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeGminaName('  Warszawa  ')).toBe('Warszawa');
  });

  it('collapses internal runs of whitespace to a single space', () => {
    expect(normalizeGminaName('Nowa   Sól')).toBe('Nowa Sól');
  });
});

describe('createGmina', () => {
  beforeEach(() => {
    mockReset(prisma);
  });

  it('creates a new gmina when no case/whitespace-insensitive match exists', async () => {
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({ id: 'g1', name: 'Warszawa' } as any);

    const result = await createGmina({ name: '  Warszawa  ' });

    expect(result).toEqual({ gmina: { id: 'g1', name: 'Warszawa' }, created: true });
    expect(prisma.gmina.findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'Warszawa', mode: 'insensitive' } },
    });
    expect(prisma.gmina.create).toHaveBeenCalledWith({ data: { name: 'Warszawa' } });
  });

  it('reuses an existing gmina instead of creating a duplicate when only case differs', async () => {
    prisma.gmina.findFirst.mockResolvedValue({ id: 'existing-1', name: 'Warszawa' } as any);

    const result = await createGmina({ name: 'WARSZAWA' });

    expect(result).toEqual({ gmina: { id: 'existing-1', name: 'Warszawa' }, created: false });
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('reuses an existing gmina instead of creating a duplicate when only whitespace differs', async () => {
    prisma.gmina.findFirst.mockResolvedValue({ id: 'existing-1', name: 'Nowa Sól' } as any);

    const result = await createGmina({ name: 'Nowa   Sól  ' });

    expect(result).toEqual({ gmina: { id: 'existing-1', name: 'Nowa Sól' }, created: false });
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('rejects a blank name without touching the database', async () => {
    const result = await createGmina({ name: '   ' });

    expect(result).toEqual({ error: 'Nazwa gminy jest wymagana.' });
    expect(prisma.gmina.findFirst).not.toHaveBeenCalled();
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('passes through optional fields when creating', async () => {
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({ id: 'g1', name: 'Warszawa' } as any);

    await createGmina({ name: 'Warszawa', powiat: 'warszawski', voivodeship: 'mazowieckie' });

    expect(prisma.gmina.create).toHaveBeenCalledWith({
      data: { name: 'Warszawa', powiat: 'warszawski', voivodeship: 'mazowieckie' },
    });
  });

  it('recovers by looking up the existing row on a race (unique constraint violation)', async () => {
    const { Prisma } = await import('@prisma/client');
    prisma.gmina.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'race-1', name: 'Warszawa' } as any);
    prisma.gmina.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.19.1',
      })
    );

    const result = await createGmina({ name: 'Warszawa' });

    expect(result).toEqual({ gmina: { id: 'race-1', name: 'Warszawa' }, created: false });
  });
});
