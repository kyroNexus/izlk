CREATE TYPE "ProjectQueueStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'PAUSED', 'DONE');

ALTER TABLE "ProjectSection"
ADD COLUMN "durationDays" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "deadline" TIMESTAMP(3),
ADD COLUMN "queuePosition" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "queueStatus" "ProjectQueueStatus" NOT NULL DEFAULT 'QUEUED',
ADD COLUMN "comment" TEXT;

CREATE INDEX "ProjectSection_code_responsibleId_queuePosition_idx" ON "ProjectSection"("code", "responsibleId", "queuePosition");
