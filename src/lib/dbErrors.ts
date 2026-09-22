import { Prisma } from '@prisma/client';

// SQLSTATE for a CHECK constraint violation in Postgres.
export const CHECK_VIOLATION_SQLSTATE = '23514';

// The constraints from prisma/migrations/20260921220000_quantity_check_constraints
// and the user-facing 409 each maps to. Every writer of these counters routes
// its transaction error through describeCheckViolation() below, so a
// violation — which can only mean "a concurrent write got there first" or a
// snapshot that went stale mid-request — surfaces as a conflict, never as a
// generic 500.
export const CHECK_CONSTRAINT_MESSAGES = {
  resource_reserved_within_quantity:
    'Zasób nie ma już wystarczającej dostępnej ilości — ktoś właśnie zmienił jego stan.',
  need_fulfilled_within_needed:
    'Zapotrzebowanie zostało w międzyczasie pokryte w większym stopniu, niż pozwala ta operacja.',
  allocation_returns_within_quantity:
    'Łączna zwrócona i nie podlegająca zwrotowi ilość przekroczyłaby ilość tego przydziału.',
} as const;

export type CheckConstraintName = keyof typeof CHECK_CONSTRAINT_MESSAGES;

const FALLBACK_MESSAGE = 'Operacja została odrzucona, bo dane zmieniły się w międzyczasie. Odśwież widok i spróbuj ponownie.';

export interface CheckViolation {
  /** Name of the violated constraint, or null when Postgres reported 23514 without a recognisable name. */
  constraint: CheckConstraintName | null;
  /** Ready-to-return Polish error message for the 409 response. */
  message: string;
}

/**
 * Recognises a Postgres CHECK constraint violation raised through Prisma
 * Client. Prisma has no dedicated P-code for these: they arrive as a
 * PrismaClientUnknownRequestError whose message embeds the driver's
 * `PostgresError { code: "23514", message: "... violates check constraint
 * \"<name>\"" ... }` — verified empirically against Prisma 5.22 / Postgres 16,
 * see docs/demo-hardening-map-resources-plan.md Крок 3. Anything else
 * (network error, P20xx known errors, plain Error) returns null so callers
 * fall through to their existing 500 path.
 */
export function describeCheckViolation(err: unknown): CheckViolation | null {
  if (!(err instanceof Prisma.PrismaClientUnknownRequestError)) return null;
  if (!err.message.includes(`code: "${CHECK_VIOLATION_SQLSTATE}"`)) return null;

  const match = err.message.match(/violates check constraint \\?"([a-z_]+)\\?"/);
  const name = match?.[1];
  if (name && name in CHECK_CONSTRAINT_MESSAGES) {
    const constraint = name as CheckConstraintName;
    return { constraint, message: CHECK_CONSTRAINT_MESSAGES[constraint] };
  }
  return { constraint: null, message: FALLBACK_MESSAGE };
}
