-- Keep the PR1 confirmer consistent with User while preserving historical contracts.
UPDATE "Contract"
SET "pr1ConfirmedById" = NULL
WHERE "pr1ConfirmedById" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "Contract"."pr1ConfirmedById");

CREATE INDEX "Contract_pr1ConfirmedById_idx" ON "Contract"("pr1ConfirmedById");

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_pr1ConfirmedById_fkey"
  FOREIGN KEY ("pr1ConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
