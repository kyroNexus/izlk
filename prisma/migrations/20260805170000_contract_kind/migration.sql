CREATE TYPE "ContractKind" AS ENUM ('SMR', 'MK', 'PROJECT');
ALTER TABLE "Contract" ADD COLUMN "kind" "ContractKind" NOT NULL DEFAULT 'SMR';
CREATE INDEX "Contract_kind_idx" ON "Contract"("kind");
