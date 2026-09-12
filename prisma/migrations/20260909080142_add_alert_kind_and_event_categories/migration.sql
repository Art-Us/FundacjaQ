-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('ALERT', 'EVENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertCategory" ADD VALUE 'FESTIVAL';
ALTER TYPE "AlertCategory" ADD VALUE 'CONCERT';
ALTER TYPE "AlertCategory" ADD VALUE 'SPORT';
ALTER TYPE "AlertCategory" ADD VALUE 'COMMUNITY';
ALTER TYPE "AlertCategory" ADD VALUE 'FAIR';
ALTER TYPE "AlertCategory" ADD VALUE 'CULTURE';
ALTER TYPE "AlertCategory" ADD VALUE 'OTHER_EVENT';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "kind" "AlertKind" NOT NULL DEFAULT 'ALERT';
