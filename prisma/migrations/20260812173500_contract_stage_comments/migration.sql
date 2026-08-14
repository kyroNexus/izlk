CREATE TABLE "ContractStageComment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "stage" "ContractWorkflowStage" NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContractStageComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractStageComment_contractId_stage_key" ON "ContractStageComment"("contractId", "stage");
CREATE INDEX "ContractStageComment_contractId_idx" ON "ContractStageComment"("contractId");
ALTER TABLE "ContractStageComment" ADD CONSTRAINT "ContractStageComment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
