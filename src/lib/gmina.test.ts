import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

vi.mock('./prisma');

import { prisma as prismaImport } from './prisma';
import {
  requiresGmina,
  scopedGminaWhere,
  normalizeGminaName,
  createGmina,
  resolveGminaId,
  getGminaLocationOptions,
} from './gmina';

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

describe('resolveGminaId', () => {
  beforeEach(() => {
    mockReset(prisma);
  });

  it('returns the id when the given gminaId exists', async () => {
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);

    const result = await resolveGminaId({ gminaId: 'g1' });

    expect(result).toEqual({ id: 'g1', created: false, gmina: null });
  });

  it('errors when the given gminaId does not exist', async () => {
    prisma.gmina.findUnique.mockResolvedValue(null);

    const result = await resolveGminaId({ gminaId: 'missing' });

    expect(result).toEqual({ error: 'Wybrana gmina nie istnieje.' });
  });

  it('returns a clean error instead of throwing when looking up the gminaId fails', async () => {
    prisma.gmina.findUnique.mockRejectedValue(new Error('connection lost'));

    const result = await resolveGminaId({ gminaId: 'g1' });

    expect(result).toEqual({ error: 'Nie udało się zweryfikować gminy.' });
  });

  it('creates (or reuses) a gmina from newGminaName when no gminaId is given', async () => {
    prisma.gmina.findFirst.mockResolvedValue(null);
    prisma.gmina.create.mockResolvedValue({ id: 'new-1', name: 'Nowa Gmina' } as any);

    const result = await resolveGminaId({ newGminaName: 'Nowa Gmina' });

    expect(result).toEqual({ id: 'new-1', created: true, gmina: { id: 'new-1', name: 'Nowa Gmina' } });
  });

  it('prefers gminaId over newGminaName when both are given', async () => {
    prisma.gmina.findUnique.mockResolvedValue({ id: 'g1' } as any);

    const result = await resolveGminaId({ gminaId: 'g1', newGminaName: 'Ignored' });

    expect(result).toEqual({ id: 'g1', created: false, gmina: null });
    expect(prisma.gmina.findFirst).not.toHaveBeenCalled();
    expect(prisma.gmina.create).not.toHaveBeenCalled();
  });

  it('propagates a createGmina error when newGminaName is blank', async () => {
    const result = await resolveGminaId({ newGminaName: '   ' });

    expect(result).toEqual({ error: 'Nazwa gminy jest wymagana.' });
  });

  it('errors when neither gminaId nor newGminaName is given', async () => {
    const result = await resolveGminaId({});

    expect(result).toEqual({ error: 'Gmina jest wymagana.' });
    expect(prisma.gmina.findUnique).not.toHaveBeenCalled();
    expect(prisma.gmina.findFirst).not.toHaveBeenCalled();
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

  it('returns a clean error instead of throwing when the duplicate-check read itself fails', async () => {
    prisma.gmina.findFirst.mockRejectedValue(new Error('connection lost'));

    const result = await createGmina({ name: 'Warszawa' });

    expect(result).toEqual({ error: 'Nie udało się utworzyć gminy.' });
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

describe('getGminaLocationOptions', () => {
  beforeEach(() => {
    mockReset(prisma);
  });

  it('only queries gminas that have a voivodeship set, distinct by voivodeship+powiat', async () => {
    prisma.gmina.findMany.mockResolvedValue([]);

    await getGminaLocationOptions();

    expect(prisma.gmina.findMany).toHaveBeenCalledWith({
      where: { voivodeship: { not: null } },
      select: { voivodeship: true, powiat: true },
      distinct: ['voivodeship', 'powiat'],
    });
  });

  it('returns an empty array when nothing matches', async () => {
    prisma.gmina.findMany.mockResolvedValue([]);

    expect(await getGminaLocationOptions()).toEqual([]);
  });

  it('groups powiats under every voivodeship they appear in, sorted and deduplicated, tolerating a null powiat', async () => {
    prisma.gmina.findMany.mockResolvedValue([
      { voivodeship: 'mazowieckie', powiat: 'zamojski' },
      { voivodeship: 'mazowieckie', powiat: 'warszawski' },
      { voivodeship: 'lubelskie', powiat: 'zamojski' },
      { voivodeship: 'lubelskie', powiat: 'zamojski' },
      { voivodeship: 'podlaskie', powiat: null },
    ] as any);

    const result = await getGminaLocationOptions();

    expect(result).toEqual([
      { voivodeship: 'lubelskie', powiats: ['zamojski'] },
      { voivodeship: 'mazowieckie', powiats: ['warszawski', 'zamojski'] },
      { voivodeship: 'podlaskie', powiats: [] },
    ]);
  });
});
