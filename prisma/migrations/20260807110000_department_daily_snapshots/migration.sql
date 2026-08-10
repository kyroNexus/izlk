-- Фактические ежедневные срезы нагрузки для исторического графика главной.
CREATE TABLE "DepartmentDailySnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "department" TEXT NOT NULL,
    "working" INTEGER NOT NULL DEFAULT 0,
    "attention" INTEGER NOT NULL DEFAULT 0,
    "paused" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentDailySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DepartmentDailySnapshot_date_department_key"
  ON "DepartmentDailySnapshot"("date", "department");
CREATE INDEX "DepartmentDailySnapshot_department_date_idx"
  ON "DepartmentDailySnapshot"("department", "date");
