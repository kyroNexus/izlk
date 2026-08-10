-- A shared certificate or standard drawing may belong to several contracts.
-- Keep deduplication strict only within a particular contract.
DROP INDEX IF EXISTS "Document_sha256_key";
CREATE UNIQUE INDEX "Document_contractId_sha256_key" ON "Document"("contractId", "sha256");
