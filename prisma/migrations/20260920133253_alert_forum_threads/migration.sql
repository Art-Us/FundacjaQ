-- CreateEnum
CREATE TYPE "AlertMessageType" AS ENUM ('STAFF_COMMUNIQUE', 'SITUATION_UPDATE', 'LOGISTICS_TRANSPORT', 'UNIT_SUPPORT', 'OTHER');

-- DropIndex
DROP INDEX "AlertMessage_alertId_createdAt_idx";

-- AlterTable
ALTER TABLE "AlertMessage" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "type" "AlertMessageType";

-- CreateIndex
CREATE INDEX "AlertMessage_alertId_parentId_createdAt_idx" ON "AlertMessage"("alertId", "parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "AlertMessage" ADD CONSTRAINT "AlertMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AlertMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
