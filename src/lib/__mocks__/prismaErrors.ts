import { Prisma } from '@prisma/client';

/**
 * Test-only: builds the exact error Prisma 5.22 throws when Postgres rejects a
 * write with a CHECK constraint violation (SQLSTATE 23514). Captured verbatim
 * from a real run against the local database — Prisma has no P-code for these,
 * so lib/dbErrors.ts has to parse this message shape, and route tests use
 * this helper to simulate "the DB constraint fired" without a database.
 */
export function fakeCheckViolation(constraint: string, relation = 'Resource'): Prisma.PrismaClientUnknownRequestError {
  const message =
    '\nInvalid `prisma.resource.update()` invocation:\n\n\nError occurred during query execution:\n' +
    'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", ' +
    `message: "new row for relation \\"${relation}\\" violates check constraint \\"${constraint}\\"", severity: "ERROR", ` +
    'detail: Some("Failing row contains (...)."), column: None, hint: None }), transient: false })';
  return new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: '5.22.0' });
}
