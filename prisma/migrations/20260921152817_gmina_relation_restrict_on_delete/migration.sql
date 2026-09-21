-- DropForeignKey
ALTER TABLE "InviteToken" DROP CONSTRAINT "InviteToken_gminaId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_gminaId_fkey";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_gminaId_fkey" FOREIGN KEY ("gminaId") REFERENCES "Gmina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_gminaId_fkey" FOREIGN KEY ("gminaId") REFERENCES "Gmina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
