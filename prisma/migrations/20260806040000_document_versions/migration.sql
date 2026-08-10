CREATE TYPE "DocumentState" AS ENUM ('SOURCE', 'SIGNED', 'ARCHIVE');

ALTER TABLE "Document"
ADD COLUMN "state" "DocumentState" NOT NULL DEFAULT 'SOURCE',
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "Document" SET "state" = 'SIGNED' WHERE "signedAt" IS NOT NULL;

CREATE INDEX "Document_contractId_state_idx" ON "Document"("contractId", "state");
