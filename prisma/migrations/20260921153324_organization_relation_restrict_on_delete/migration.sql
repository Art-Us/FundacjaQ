-- DropForeignKey
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "InviteToken" DROP CONSTRAINT "InviteToken_organizationId_fkey";

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
