-- AlterTable
ALTER TABLE "StageComment" ALTER COLUMN "text" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StageCommentAttachment" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "isImage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageCommentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageCommentAttachment_commentId_idx" ON "StageCommentAttachment"("commentId");

-- AddForeignKey
ALTER TABLE "StageCommentAttachment" ADD CONSTRAINT "StageCommentAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "StageComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
