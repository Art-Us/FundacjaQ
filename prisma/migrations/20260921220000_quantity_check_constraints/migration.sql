-- Database-level guards for the resource module's denormalized counters
-- (docs/demo-hardening-map-resources-plan.md, Крок 3).
--
-- Five routes write these columns with a read-then-write pattern
-- (POST /api/alerts/[id]/allocations, POST /api/allocations/[id]/return-events,
-- POST /api/alerts/[id]/cancel-with-return, PATCH /api/resources/[id],
-- PATCH /api/needs/[id]). Крок 2 made the allocation path atomic, but the
-- others still compare against a snapshot — and even the atomic path uses a
-- snapshot of Resource.quantity in its WHERE. These constraints are the one
-- safety net that covers every writer at once: Postgres rejects the offending
-- statement (SQLSTATE 23514) and the surrounding transaction rolls back.
--
-- Written by hand: Prisma 5 has no @@check in the schema DSL, so the schema
-- file stays unchanged and this migration is the single source of truth for
-- the constraints. Routes map 23514 to a 409 via lib/dbErrors.ts.
--
-- Safe to apply only if no existing row violates a condition — verified on
-- the dev database before this migration was written (0 rows in each table).
-- On a database that has already been hit by the pre-Крок-2 allocation race,
-- run first:
--   UPDATE "Resource"  SET "reservedQuantity"  = LEAST("reservedQuantity",  "quantity")       WHERE "reservedQuantity"  > "quantity";
--   UPDATE "AlertNeed" SET "quantityFulfilled" = LEAST("quantityFulfilled", "quantityNeeded") WHERE "quantityFulfilled" > "quantityNeeded";

ALTER TABLE "Resource"
  ADD CONSTRAINT "resource_reserved_within_quantity"
  CHECK ("reservedQuantity" >= 0 AND "reservedQuantity" <= "quantity");

ALTER TABLE "AlertNeed"
  ADD CONSTRAINT "need_fulfilled_within_needed"
  CHECK ("quantityFulfilled" >= 0 AND "quantityFulfilled" <= "quantityNeeded");

ALTER TABLE "ResourceAllocation"
  ADD CONSTRAINT "allocation_returns_within_quantity"
  CHECK (
    "quantityReturned" >= 0
    AND "quantityNotReturnable" >= 0
    AND "quantityReturned" + "quantityNotReturnable" <= "quantity"
  );
