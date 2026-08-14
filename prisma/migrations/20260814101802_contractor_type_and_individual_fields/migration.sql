-- CreateEnum
CREATE TYPE "ContractorType" AS ENUM ('LEGAL', 'INDIVIDUAL');

-- AlterTable
ALTER TABLE "Contractor" ADD COLUMN     "passportDeptCode" TEXT,
ADD COLUMN     "passportIssuedAt" TIMESTAMP(3),
ADD COLUMN     "passportIssuedBy" TEXT,
ADD COLUMN     "passportNumber" TEXT,
ADD COLUMN     "passportSeries" TEXT,
ADD COLUMN     "snils" TEXT,
ADD COLUMN     "type" "ContractorType" NOT NULL DEFAULT 'LEGAL';
