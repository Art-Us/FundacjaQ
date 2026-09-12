-- DropIndex
DROP INDEX "AuditLog_entityType_entityId_idx";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_seq_idx" ON "AuditLog"("entityType", "entityId", "seq");
