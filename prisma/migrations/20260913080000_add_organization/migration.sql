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
-- one each. A user with no gmina (only possible for a pre-existing ADMIN —
-- see requiresGmina() in lib/gmina.ts) has nothing to scope a new
-- Organization row to, so their free-text value is dropped here rather than
-- left half-migrated; Organization was never a concept the old plain-text
-- field actually enforced per-gmina, so this is a real, if narrow, one-time
-- data loss for that specific case, not an oversight.
INSERT INTO "Organization" ("id", "name", "gminaId", "createdAt", "updatedAt")
SELECT DISTINCT ON (u."organization", u."gminaId")
  md5(random()::text || clock_timestamp()::text || u."id"),
  u."organization",
  u."gminaId",
  now(),
  now()
FROM "User" u
WHERE u."organization" IS NOT NULL
  AND btrim(u."organization") <> ''
  AND u."gminaId" IS NOT NULL
ORDER BY u."organization", u."gminaId", u."id";

UPDATE "User" u
SET "organizationId" = o."id"
FROM "Organization" o
WHERE u."organization" IS NOT NULL
  AND btrim(u."organization") <> ''
  AND u."gminaId" IS NOT NULL
  AND o."name" = u."organization"
  AND o."gminaId" = u."gminaId";

-- AlterTable: drop the old free-text column now that any preservable values have been migrated
ALTER TABLE "User" DROP COLUMN "organization";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
