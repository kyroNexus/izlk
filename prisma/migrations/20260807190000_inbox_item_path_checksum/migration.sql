-- Prevent two overlapping scanner runs from creating duplicate queue rows for
-- the same file version.  sourcePath alone is intentionally not unique: a
-- manager may replace a file in place and the replacement has a new checksum.
CREATE UNIQUE INDEX "InboxItem_sourcePath_sha256_key" ON "InboxItem"("sourcePath", "sha256");
