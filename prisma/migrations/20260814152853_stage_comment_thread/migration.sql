-- CreateTable
CREATE TABLE "StageComment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "stage" "ContractWorkflowStage" NOT NULL,
    "authorId" TEXT,
    "text" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StageComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageComment_contractId_stage_createdAt_idx" ON "StageComment"("contractId", "stage", "createdAt");

-- CreateIndex
CREATE INDEX "StageComment_authorId_idx" ON "StageComment"("authorId");

-- AddForeignKey
ALTER TABLE "StageComment" ADD CONSTRAINT "StageComment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageComment" ADD CONSTRAINT "StageComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: перенос существующих заметок из старой перезаписываемой модели.
-- ContractStageComment не удаляется — остаётся как страховочная копия.
INSERT INTO "StageComment" ("id", "contractId", "stage", "authorId", "text", "createdAt")
SELECT gen_random_uuid()::text, "contractId", "stage", "updatedById", "text", "createdAt"
FROM "ContractStageComment";

-- Backfill: непустые комментарии из неизменяемого журнала переходов (в основном
-- авто-описания реальных переходов — что и должно засчитываться как "зелёный").
INSERT INTO "StageComment" ("id", "contractId", "stage", "authorId", "text", "createdAt")
SELECT gen_random_uuid()::text, "contractId", "toStage", "changedById", "comment", "createdAt"
FROM "ContractStageHistory"
WHERE "comment" IS NOT NULL AND "comment" <> '';
