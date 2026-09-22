import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { describeCheckViolation, CHECK_CONSTRAINT_MESSAGES } from './dbErrors';
import { fakeCheckViolation } from './__mocks__/prismaErrors';

describe('describeCheckViolation', () => {
  it.each(Object.keys(CHECK_CONSTRAINT_MESSAGES) as (keyof typeof CHECK_CONSTRAINT_MESSAGES)[])(
    'maps the %s constraint to its user-facing message',
    (constraint) => {
      expect(describeCheckViolation(fakeCheckViolation(constraint))).toEqual({
        constraint,
        message: CHECK_CONSTRAINT_MESSAGES[constraint],
      });
    }
  );

  it('still reports a 23514 with an unknown constraint name, with a generic message', () => {
    const result = describeCheckViolation(fakeCheckViolation('some_future_constraint'));
    expect(result).not.toBeNull();
    expect(result!.constraint).toBeNull();
    expect(result!.message).toMatch(/Odśwież/);
  });

  it('ignores an unknown-request error with a different SQLSTATE', () => {
    const err = new Prisma.PrismaClientUnknownRequestError(
      'ConnectorError(... PostgresError { code: "40001", message: "could not serialize access" ...)',
      { clientVersion: '5.22.0' }
    );
    expect(describeCheckViolation(err)).toBeNull();
  });

  it('ignores known Prisma errors (e.g. P2002 unique violation)', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
    });
    expect(describeCheckViolation(err)).toBeNull();
  });

  it('ignores plain errors and non-errors', () => {
    expect(describeCheckViolation(new Error('connection lost'))).toBeNull();
    expect(describeCheckViolation('23514')).toBeNull();
    expect(describeCheckViolation(null)).toBeNull();
    expect(describeCheckViolation(undefined)).toBeNull();
  });
});
