-- AlterTable: a COORDINATOR's invite is now scoped to their own organization
-- (see POST /api/admin/invites), not just their gmina. Nullable, same as
-- gminaId, so existing rows and ADMIN-issued invites (which don't set an
-- organization) are unaffected.
ALTER TABLE "InviteToken" ADD COLUMN "organizationId" TEXT;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
