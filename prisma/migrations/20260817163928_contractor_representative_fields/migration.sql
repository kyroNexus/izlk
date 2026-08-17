-- AlterTable
ALTER TABLE "Contractor" ADD COLUMN     "representativeName" TEXT,
ADD COLUMN     "representativePassportDeptCode" TEXT,
ADD COLUMN     "representativePassportIssuedAt" TIMESTAMP(3),
ADD COLUMN     "representativePassportIssuedBy" TEXT,
ADD COLUMN     "representativePassportNumber" TEXT,
ADD COLUMN     "representativePassportSeries" TEXT,
ADD COLUMN     "representativeProxyDate" TIMESTAMP(3),
ADD COLUMN     "representativeProxyNumber" TEXT,
ADD COLUMN     "representativeSnils" TEXT;
