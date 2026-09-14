-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ORGANIZATION_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'ORGANIZATION_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'ORGANIZATION_DELETE';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'ORGANIZATION';

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "street" TEXT,
    "houseNumber" TEXT,
    "apartmentNumber" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "gminaId" TEXT NOT NULL,
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_gminaId_key" ON "Organization"("name", "gminaId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_gminaId_fkey" FOREIGN KEY ("gminaId") REFERENCES "Gmina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: add the new FK column alongside the old free-text one for now
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;

-- Data migration: an existing free-text User.organization value becomes a
-- real Organization row (scoped to that user's own gmina, since
-- Organization.gminaId is NOT NULL), and every user sharing the same
-- (organization text, gmina) pair is pointed at the SAME new row rather than
-- one each — matched case/whitespace-insensitively via the same
-- trim+collapse-internal-whitespace rule as normalizeOrganizationName() in
-- lib/organization.ts, so "Caritas" and " caritas  " for the same gmina
-- become one row instead of two silently-duplicate ones. A user with no
-- gmina has nothing to scope a new Organization row to, so their free-text
-- value is dropped here rather than left half-migrated; note gminaId is only
-- guaranteed non-null going forward (enforced in application code at
-- create/update time, not as a DB constraint — see requiresGmina() in
-- lib/gmina.ts), so this can drop data for any old COORDINATOR/VOLUNTEER row
-- that predates that rule being enforced, not only pre-existing ADMINs.
-- Before running this against production data, check how many affected rows
-- actually exist:
--   SELECT count(*) FROM "User"
--   WHERE "gminaId" IS NULL AND "organization" IS NOT NULL AND btrim("organization") <> '';
INSERT INTO "Organization" ("id", "name", "gminaId", "createdAt", "updatedAt")
SELECT DISTINCT ON (lower(regexp_replace(btrim(u."organization"), '\s+', ' ', 'g')), u."gminaId")
  md5(random()::text || clock_timestamp()::text || u."id"),
  regexp_replace(btrim(u."organization"), '\s+', ' ', 'g'),
  u."gminaId",
  now(),
  now()
FROM "User" u
WHERE u."organization" IS NOT NULL
  AND btrim(u."organization") <> ''
  AND u."gminaId" IS NOT NULL
ORDER BY lower(regexp_replace(btrim(u."organization"), '\s+', ' ', 'g')), u."gminaId", u."id";

UPDATE "User" u
SET "organizationId" = o."id"
FROM "Organization" o
WHERE u."organization" IS NOT NULL
  AND btrim(u."organization") <> ''
  AND u."gminaId" IS NOT NULL
  AND lower(o."name") = lower(regexp_replace(btrim(u."organization"), '\s+', ' ', 'g'))
  AND o."gminaId" = u."gminaId";

-- AlterTable: drop the old free-text column now that any preservable values have been migrated
ALTER TABLE "User" DROP COLUMN "organization";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
