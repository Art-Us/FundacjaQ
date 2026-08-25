-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'NGO', 'FIREFIGHTER', 'COORDINATOR', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_USE', 'DEPLETED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VOLUNTEER',
    "organization" TEXT,
    "phone" TEXT,
    "gminaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gmina" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "powiat" TEXT NOT NULL,
    "voivodeship" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gmina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'szt',
    "status" "ResourceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "location" TEXT,
    "categoryId" TEXT NOT NULL,
    "gminaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT,
    "authorId" TEXT,
    "gminaId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Gmina_name_key" ON "Gmina"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceCategory_name_key" ON "ResourceCategory"("name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_gminaId_fkey" FOREIGN KEY ("gminaId") REFERENCES "Gmina"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_gminaId_fkey" FOREIGN KEY ("gminaId") REFERENCES "Gmina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_gminaId_fkey" FOREIGN KEY ("gminaId") REFERENCES "Gmina"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
