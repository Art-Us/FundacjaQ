-- Simplify Role enum to ADMIN, COORDINATOR, VOLUNTEER only
BEGIN;

CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'COORDINATOR', 'VOLUNTEER');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "InviteToken" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");

ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'VOLUNTEER';

COMMIT;
