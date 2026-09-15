-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'USER_ACTIVATE', 'USER_DEACTIVATE', 'GMINA_CREATE', 'GMINA_UPDATE', 'GMINA_DELETE', 'INVITE_CREATE', 'INVITE_REVOKE');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('USER', 'GMINA', 'INVITE_TOKEN');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actorName" TEXT,
    "actorRole" "Role" NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "gminaId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" TIMESTAMP(3),
    "revertedById" TEXT,
    "isRevert" BOOLEAN NOT NULL DEFAULT false,
    "revertOfId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_revertOfId_fkey" FOREIGN KEY ("revertOfId") REFERENCES "AuditLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
