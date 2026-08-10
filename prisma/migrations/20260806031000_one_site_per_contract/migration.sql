-- В текущем процессе компании одна карточка площадки относится к одному договору.
-- Объединяем только дубли карточек одного договора, сохраняя связанные записи.

WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "contractId" ORDER BY "createdAt", id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY "contractId" ORDER BY "createdAt", id) AS rn
  FROM "Site"
)
UPDATE "SiteWork" AS work
SET "siteId" = ranked.keep_id
FROM ranked
WHERE ranked.rn > 1 AND work."siteId" = ranked.id;

WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "contractId" ORDER BY "createdAt", id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY "contractId" ORDER BY "createdAt", id) AS rn
  FROM "Site"
)
UPDATE "SiteEvent" AS event
SET "siteId" = ranked.keep_id
FROM ranked
WHERE ranked.rn > 1 AND event."siteId" = ranked.id;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "siteId", type, text, "occurredAt" ORDER BY "createdAt", id) AS rn
  FROM "SiteEvent"
)
DELETE FROM "SiteEvent" AS event
USING ranked
WHERE ranked.rn > 1 AND event.id = ranked.id;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "contractId" ORDER BY "createdAt", id) AS rn
  FROM "Site"
)
DELETE FROM "Site" AS site
USING ranked
WHERE ranked.rn > 1 AND site.id = ranked.id;

CREATE UNIQUE INDEX "Site_contractId_key" ON "Site"("contractId");
