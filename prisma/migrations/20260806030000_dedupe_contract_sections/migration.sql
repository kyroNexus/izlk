-- Перепривязываем зависимые записи к самой ранней записи в каждой группе,
-- удаляем только подтверждённые дубли и запрещаем их повторное появление.

WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS rn
  FROM "Estimate"
)
UPDATE "Document" AS document
SET "estimateId" = ranked.keep_id
FROM ranked
WHERE ranked.rn > 1 AND document."estimateId" = ranked.id;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS rn
  FROM "Estimate"
)
DELETE FROM "Estimate" AS estimate
USING ranked
WHERE ranked.rn > 1 AND estimate.id = ranked.id;

WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS rn
  FROM "Agreement"
)
UPDATE "Estimate" AS estimate
SET "agreementId" = ranked.keep_id
FROM ranked
WHERE ranked.rn > 1 AND estimate."agreementId" = ranked.id;

WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS rn
  FROM "Agreement"
)
UPDATE "Document" AS document
SET "agreementId" = ranked.keep_id
FROM ranked
WHERE ranked.rn > 1 AND document."agreementId" = ranked.id;

WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS rn
  FROM "Agreement"
)
UPDATE "Agreement" AS child
SET "parentId" = ranked.keep_id
FROM ranked
WHERE ranked.rn > 1 AND child."parentId" = ranked.id;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", number ORDER BY "createdAt", id) AS rn
  FROM "Agreement"
)
DELETE FROM "Agreement" AS agreement
USING ranked
WHERE ranked.rn > 1 AND agreement.id = ranked.id;

WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "contractId", code ORDER BY "createdAt", id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", code ORDER BY "createdAt", id) AS rn
  FROM "ProjectSection"
)
UPDATE "Document" AS document
SET "projectSectionId" = ranked.keep_id
FROM ranked
WHERE ranked.rn > 1 AND document."projectSectionId" = ranked.id;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", code ORDER BY "createdAt", id) AS rn
  FROM "ProjectSection"
)
DELETE FROM "ProjectSection" AS section
USING ranked
WHERE ranked.rn > 1 AND section.id = ranked.id;

WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "contractId", name ORDER BY "createdAt", id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", name ORDER BY "createdAt", id) AS rn
  FROM "ExecutiveDoc"
)
UPDATE "Document" AS document
SET "executiveDocId" = ranked.keep_id
FROM ranked
WHERE ranked.rn > 1 AND document."executiveDocId" = ranked.id;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "contractId", name ORDER BY "createdAt", id) AS rn
  FROM "ExecutiveDoc"
)
DELETE FROM "ExecutiveDoc" AS executive
USING ranked
WHERE ranked.rn > 1 AND executive.id = ranked.id;

CREATE UNIQUE INDEX "Agreement_contractId_number_key" ON "Agreement"("contractId", "number");
CREATE UNIQUE INDEX "Estimate_contractId_number_key" ON "Estimate"("contractId", "number");
CREATE UNIQUE INDEX "ProjectSection_contractId_code_key" ON "ProjectSection"("contractId", "code");
CREATE UNIQUE INDEX "ExecutiveDoc_contractId_name_key" ON "ExecutiveDoc"("contractId", "name");
