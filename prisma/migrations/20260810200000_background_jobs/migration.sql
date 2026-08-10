CREATE TYPE "BackgroundJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'RUNNING',
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackgroundJob_type_startedAt_idx" ON "BackgroundJob"("type", "startedAt");
CREATE INDEX "BackgroundJob_status_startedAt_idx" ON "BackgroundJob"("status", "startedAt");
