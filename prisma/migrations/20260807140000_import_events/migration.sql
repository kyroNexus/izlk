CREATE TABLE "ImportEvent" (
    "id" TEXT NOT NULL,
    "inboxItemId" TEXT,
    "fileName" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "message" TEXT,
    "contractId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportEvent_inboxItemId_createdAt_idx" ON "ImportEvent"("inboxItemId", "createdAt");
CREATE INDEX "ImportEvent_contractId_createdAt_idx" ON "ImportEvent"("contractId", "createdAt");
CREATE INDEX "ImportEvent_outcome_createdAt_idx" ON "ImportEvent"("outcome", "createdAt");
CREATE INDEX "ImportEvent_createdAt_idx" ON "ImportEvent"("createdAt");

ALTER TABLE "ImportEvent" ADD CONSTRAINT "ImportEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
