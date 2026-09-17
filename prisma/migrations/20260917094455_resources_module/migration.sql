/*
  Warnings:

  - Added the required column `organizationId` to the `Resource` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ResourceGroup" AS ENUM ('PEOPLE', 'WATER', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ResourceHorizon" AS ENUM ('H24', 'H48', 'H72', 'WEEK');

-- CreateEnum
CREATE TYPE "NeedUrgency" AS ENUM ('NORMAL', 'PILNE', 'KRYTYCZNY');

-- CreateEnum
CREATE TYPE "NeedStatus" AS ENUM ('OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('DELIVERY_AGREED', 'DELIVERED', 'RETURN_AGREED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'RESOURCE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'RESOURCE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'RESOURCE_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'ALERT_NEED_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'ALERT_NEED_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'ALERT_NEED_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'RESOURCE_ALLOCATION_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'RESOURCE_ALLOCATION_STATUS_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'RESOURCE_ALLOCATION_RETURN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'RESOURCE';
ALTER TYPE "AuditEntityType" ADD VALUE 'ALERT_NEED';
ALTER TYPE "AuditEntityType" ADD VALUE 'RESOURCE_ALLOCATION';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "organizationId" TEXT;

-- Backfill: derive each existing alert's owning organization from its
-- author's organization (Крок 5 / R6). Alerts with no author, or whose
-- author has no organization, are left NULL — matching what a fresh alert
-- created by an org-less user would get going forward.
UPDATE "Alert" a
SET "organizationId" = u."organizationId"
FROM "User" u
WHERE u.id = a."authorId";

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "horizon" "ResourceHorizon" NOT NULL DEFAULT 'H24',
ADD COLUMN     "organizationId" TEXT NOT NULL,
ADD COLUMN     "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ResourceCategory" ADD COLUMN     "group" "ResourceGroup" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "AlertNeed" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quantityNeeded" INTEGER NOT NULL,
    "quantityFulfilled" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'szt',
    "urgency" "NeedUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "NeedStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceAllocation" (
    "id" TEXT NOT NULL,
    "needId" TEXT,
    "alertId" TEXT NOT NULL,
    "resourceId" TEXT,
    "categoryId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quantityReturned" INTEGER NOT NULL DEFAULT 0,
    "quantityNotReturnable" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'szt',
    "donorOrgId" TEXT NOT NULL,
    "recipientOrgId" TEXT,
    "status" "AllocationStatus" NOT NULL DEFAULT 'DELIVERY_AGREED',
    "deliveredAt" TIMESTAMP(3),
    "returnAgreedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationReturnEvent" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "quantityReturned" INTEGER NOT NULL DEFAULT 0,
    "quantityNotReturnable" INTEGER NOT NULL DEFAULT 0,
    "notReturnableReason" TEXT,
    "message" TEXT,
    "returnedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationReturnEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationMessage" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertMessage" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorOrgId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertNeed_alertId_idx" ON "AlertNeed"("alertId");

-- CreateIndex
CREATE INDEX "ResourceAllocation_alertId_status_idx" ON "ResourceAllocation"("alertId", "status");

-- CreateIndex
CREATE INDEX "ResourceAllocation_donorOrgId_status_idx" ON "ResourceAllocation"("donorOrgId", "status");

-- CreateIndex
CREATE INDEX "AllocationReturnEvent_allocationId_idx" ON "AllocationReturnEvent"("allocationId");

-- CreateIndex
CREATE INDEX "AllocationMessage_allocationId_createdAt_idx" ON "AllocationMessage"("allocationId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertMessage_alertId_createdAt_idx" ON "AlertMessage"("alertId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_organizationId_idx" ON "Alert"("organizationId");

-- CreateIndex
CREATE INDEX "Resource_organizationId_idx" ON "Resource"("organizationId");

-- CreateIndex
CREATE INDEX "Resource_gminaId_categoryId_horizon_idx" ON "Resource"("gminaId", "categoryId", "horizon");

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertNeed" ADD CONSTRAINT "AlertNeed_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertNeed" ADD CONSTRAINT "AlertNeed_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertNeed" ADD CONSTRAINT "AlertNeed_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_needId_fkey" FOREIGN KEY ("needId") REFERENCES "AlertNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_donorOrgId_fkey" FOREIGN KEY ("donorOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReturnEvent" ADD CONSTRAINT "AllocationReturnEvent_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ResourceAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationReturnEvent" ADD CONSTRAINT "AllocationReturnEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationMessage" ADD CONSTRAINT "AllocationMessage_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ResourceAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationMessage" ADD CONSTRAINT "AllocationMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertMessage" ADD CONSTRAINT "AlertMessage_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertMessage" ADD CONSTRAINT "AlertMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
