CREATE TYPE "SiteCostCategory" AS ENUM ('EQUIPMENT', 'MATERIAL', 'OTHER');
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'CASHLESS');

CREATE TABLE "SiteCrewEntry" (
    "id" TEXT NOT NULL,
    "siteWorkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workDays" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "rate" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteCrewEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SiteCostItem" (
    "id" TEXT NOT NULL,
    "siteWorkId" TEXT NOT NULL,
    "category" "SiteCostCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "paymentType" "PaymentType" NOT NULL DEFAULT 'CASHLESS',
    "quantity" DECIMAL(15,3) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unitPrice" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteCostItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteCrewEntry_siteWorkId_idx" ON "SiteCrewEntry"("siteWorkId");
CREATE INDEX "SiteCostItem_siteWorkId_category_idx" ON "SiteCostItem"("siteWorkId", "category");
ALTER TABLE "SiteCrewEntry" ADD CONSTRAINT "SiteCrewEntry_siteWorkId_fkey" FOREIGN KEY ("siteWorkId") REFERENCES "SiteWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteCostItem" ADD CONSTRAINT "SiteCostItem_siteWorkId_fkey" FOREIGN KEY ("siteWorkId") REFERENCES "SiteWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
