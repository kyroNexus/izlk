-- Рабочая стадия и данные ПР1. Все новые поля допускают существующие договоры.
CREATE TYPE "ContractWorkflowStage" AS ENUM (
  'CONTRACT_PREPARATION',
  'AWAITING_CONTRACT_SIGNATURE',
  'PR1_DEVELOPMENT',
  'AWAITING_PR1_SIGNATURE',
  'DESIGN',
  'WAITING_PRODUCTION',
  'PRODUCTION',
  'AWAITING_SHIPMENT',
  'INSTALL_KZH',
  'INSTALL_KM',
  'CLOSED'
);

ALTER TABLE "Contract"
  ADD COLUMN "workflowStage" "ContractWorkflowStage" NOT NULL DEFAULT 'CONTRACT_PREPARATION',
  ADD COLUMN "workingDays" INTEGER,
  ADD COLUMN "pr1SignedAt" TIMESTAMP(3),
  ADD COLUMN "pr1ConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "pr1ConfirmedById" TEXT,
  ADD COLUMN "deadline" TIMESTAMP(3);

CREATE TABLE "ContractStageHistory" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "fromStage" "ContractWorkflowStage",
  "toStage" "ContractWorkflowStage" NOT NULL,
  "changedById" TEXT,
  "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractStageHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Contract_workflowStage_idx" ON "Contract"("workflowStage");
CREATE INDEX "ContractStageHistory_contractId_createdAt_idx" ON "ContractStageHistory"("contractId", "createdAt");
CREATE INDEX "ContractStageHistory_changedById_idx" ON "ContractStageHistory"("changedById");
ALTER TABLE "ContractStageHistory"
  ADD CONSTRAINT "ContractStageHistory_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractStageHistory"
  ADD CONSTRAINT "ContractStageHistory_changedById_fkey"
  FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Старые закрытые договоры должны открываться на финальной стадии.
UPDATE "Contract" SET "workflowStage" = 'CLOSED' WHERE "status" = 'CLOSED';
