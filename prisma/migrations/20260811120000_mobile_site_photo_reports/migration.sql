ALTER TABLE "SiteWork" ADD COLUMN "clientSubmissionId" TEXT;
CREATE UNIQUE INDEX "SiteWork_clientSubmissionId_key" ON "SiteWork"("clientSubmissionId");
CREATE UNIQUE INDEX "SitePhoto_siteWorkId_sha256_key" ON "SitePhoto"("siteWorkId", "sha256");
