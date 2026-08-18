-- CreateTable
CREATE TABLE "DocumentRouteRule" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRouteRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRouteRule_target_sortOrder_idx" ON "DocumentRouteRule"("target", "sortOrder");
