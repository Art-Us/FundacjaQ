-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deactivationReason" TEXT,
ADD COLUMN     "lastActivatedAt" TIMESTAMP(3),
ADD COLUMN     "lastDeactivatedAt" TIMESTAMP(3);
