CREATE TYPE "ProductionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

CREATE TABLE "ProductionPlan" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "buildingDimensions" TEXT,
  "requestNumber" TEXT,
  "frameMaterial" TEXT,
  "columnsSpec" TEXT,
  "roofSpec" TEXT,
  "ral" TEXT,
  "frameWeight" DECIMAL(15,2),
  "reinforcedConcreteWeight" DECIMAL(15,2),
  "galvanizedWeight" DECIMAL(15,2),
  "blackMetalWeight" DECIMAL(15,2),
  "locationOverride" TEXT,
  "note" TEXT,
  "priority" "ProductionPriority" NOT NULL DEFAULT 'NORMAL',
  "pipeCutAt" TIMESTAMP(3),
  "assemblyWeldingAt" TIMESTAMP(3),
  "laserCutAt" TIMESTAMP(3),
  "rollingAt" TIMESTAMP(3),
  "paintingAt" TIMESTAMP(3),
  "columnsPouringAt" TIMESTAMP(3),
  "plannedShipmentAt" TIMESTAMP(3),
  "actualShipmentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionPlan_contractId_key" ON "ProductionPlan"("contractId");
CREATE INDEX "ProductionPlan_priority_plannedShipmentAt_idx" ON "ProductionPlan"("priority", "plannedShipmentAt");
ALTER TABLE "ProductionPlan" ADD CONSTRAINT "ProductionPlan_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
