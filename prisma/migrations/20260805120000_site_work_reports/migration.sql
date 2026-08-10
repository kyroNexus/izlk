-- CreateEnum
CREATE TYPE "WorkDirection" AS ENUM ('KJ', 'KM');

-- CreateTable
CREATE TABLE "SiteWork" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "direction" "WorkDirection" NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "stage" TEXT NOT NULL,
    "crewCount" INTEGER NOT NULL DEFAULT 0,
    "crewCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "equipmentCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "materialCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePhoto" (
    "id" TEXT NOT NULL,
    "siteWorkId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SitePhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteWork_siteId_workDate_idx" ON "SiteWork"("siteId", "workDate");
CREATE INDEX "SiteWork_direction_idx" ON "SiteWork"("direction");
CREATE INDEX "SitePhoto_siteWorkId_idx" ON "SitePhoto"("siteWorkId");
CREATE INDEX "SitePhoto_sha256_idx" ON "SitePhoto"("sha256");

ALTER TABLE "SiteWork" ADD CONSTRAINT "SiteWork_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_siteWorkId_fkey" FOREIGN KEY ("siteWorkId") REFERENCES "SiteWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
