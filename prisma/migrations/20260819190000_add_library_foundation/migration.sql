-- Library configuration and read-only external archive metadata.
CREATE TYPE "LibraryIgnoreRuleType" AS ENUM ('FOLDER_EXACT', 'SUBTREE', 'EXTENSION', 'NAME_PATTERN');
CREATE TYPE "LibraryRootKind" AS ENUM ('CONTRACTS', 'PROJECTS_ACTIVE', 'PROJECTS_DONE');
CREATE TYPE "DocumentOrigin" AS ENUM ('MANAGED', 'EXTERNAL');
CREATE TYPE "LibraryScanType" AS ENUM ('SCAN', 'BACKFILL');
CREATE TYPE "LibraryScanStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "OwnEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "inn" TEXT,
    "ogrn" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OwnEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryIgnoreRule" (
    "id" TEXT NOT NULL,
    "type" "LibraryIgnoreRuleType" NOT NULL,
    "value" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryIgnoreRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryRoot" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" "LibraryRootKind" NOT NULL,
    "folderTemplate" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryRoot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibrarySettings" (
    "id" TEXT NOT NULL DEFAULT 'library',
    "contractFolderPattern" TEXT NOT NULL DEFAULT '{number}',
    "kindFolderMap" JSONB NOT NULL DEFAULT '{"SMR":"СМР","MK":"МК","PROJECT":"Проект"}',
    "autoCreateMinConfidence" INTEGER NOT NULL DEFAULT 85,
    "reviewMinConfidence" INTEGER NOT NULL DEFAULT 40,
    "ocrBudgetPerScan" INTEGER NOT NULL DEFAULT 16,
    "autoAttachToKnown" BOOLEAN NOT NULL DEFAULT true,
    "scanPollingSeconds" INTEGER NOT NULL DEFAULT 300,
    "backfillBatchSize" INTEGER NOT NULL DEFAULT 20,
    "defaultContractsRootId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LibrarySettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryScan" (
    "id" TEXT NOT NULL,
    "type" "LibraryScanType" NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "status" "LibraryScanStatus" NOT NULL DEFAULT 'RUNNING',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "LibraryScan_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Contract" ADD COLUMN "ownEntityId" TEXT, ADD COLUMN "folderPath" TEXT;
ALTER TABLE "Document" ADD COLUMN "origin" "DocumentOrigin" NOT NULL DEFAULT 'MANAGED', ADD COLUMN "externalPath" TEXT, ADD COLUMN "libraryRootId" TEXT, ADD COLUMN "mtimeMs" BIGINT, ADD COLUMN "missingAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "LibraryRoot_path_key" ON "LibraryRoot"("path");
CREATE INDEX "OwnEntity_isDefault_idx" ON "OwnEntity"("isDefault");
CREATE INDEX "LibraryIgnoreRule_enabled_type_idx" ON "LibraryIgnoreRule"("enabled", "type");
CREATE UNIQUE INDEX "LibraryIgnoreRule_type_value_key" ON "LibraryIgnoreRule"("type", "value");
CREATE INDEX "LibraryRoot_enabled_kind_idx" ON "LibraryRoot"("enabled", "kind");
CREATE UNIQUE INDEX "LibrarySettings_defaultContractsRootId_key" ON "LibrarySettings"("defaultContractsRootId");
CREATE INDEX "LibraryScan_type_startedAt_idx" ON "LibraryScan"("type", "startedAt");
CREATE INDEX "LibraryScan_status_startedAt_idx" ON "LibraryScan"("status", "startedAt");
CREATE INDEX "Contract_ownEntityId_idx" ON "Contract"("ownEntityId");
CREATE INDEX "Document_libraryRootId_externalPath_idx" ON "Document"("libraryRootId", "externalPath");

ALTER TABLE "Contract" ADD CONSTRAINT "Contract_ownEntityId_fkey" FOREIGN KEY ("ownEntityId") REFERENCES "OwnEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_libraryRootId_fkey" FOREIGN KEY ("libraryRootId") REFERENCES "LibraryRoot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LibrarySettings" ADD CONSTRAINT "LibrarySettings_defaultContractsRootId_fkey" FOREIGN KEY ("defaultContractsRootId") REFERENCES "LibraryRoot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "LibraryIgnoreRule" ("id", "type", "value", "note") VALUES
  ('library-ignore-office-temp', 'NAME_PATTERN', '~$*', 'Временные файлы Microsoft Office'),
  ('library-ignore-thumbs', 'NAME_PATTERN', 'Thumbs.db', 'Служебный файл Windows'),
  ('library-ignore-desktop', 'NAME_PATTERN', 'desktop.ini', 'Служебный файл Windows'),
  ('library-ignore-bak', 'EXTENSION', '.bak', 'Резервная копия'),
  ('library-ignore-lnk', 'EXTENSION', '.lnk', 'Ярлык Windows'),
  ('library-ignore-log', 'EXTENSION', '.log', 'Журнал'),
  ('library-ignore-tmp', 'EXTENSION', '.tmp', 'Временный файл'),
  ('library-ignore-private-trash', 'SUBTREE', '_мусор', 'Приватная рабочая область'),
  ('library-ignore-trash', 'SUBTREE', 'мусор', 'Приватная рабочая область')
ON CONFLICT ("type", "value") DO NOTHING;
