-- Commercial proposal follow-up status for the reports dashboard.
CREATE TYPE "CommercialProposalStatus" AS ENUM ('DRAFT', 'SENT', 'WAITING_RESPONSE', 'ACCEPTED', 'REJECTED');

ALTER TABLE "Document"
  ADD COLUMN "proposalStatus" "CommercialProposalStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "proposalSentAt" TIMESTAMP(3),
  ADD COLUMN "proposalRespondedAt" TIMESTAMP(3);

CREATE INDEX "Document_kind_proposalStatus_idx" ON "Document"("kind", "proposalStatus");
