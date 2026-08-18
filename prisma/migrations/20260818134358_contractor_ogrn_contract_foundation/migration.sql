-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "customerOwnSlab" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "foundationType" TEXT;

-- AlterTable
ALTER TABLE "Contractor" ADD COLUMN     "ogrn" TEXT;
