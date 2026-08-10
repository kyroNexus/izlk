ALTER TABLE "Document" ADD COLUMN "executiveDocId" TEXT;
CREATE INDEX "Document_executiveDocId_idx" ON "Document"("executiveDocId");
ALTER TABLE "Document" ADD CONSTRAINT "Document_executiveDocId_fkey" FOREIGN KEY ("executiveDocId") REFERENCES "ExecutiveDoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;
