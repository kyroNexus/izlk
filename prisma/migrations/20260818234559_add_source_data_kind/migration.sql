-- CreateEnum
CREATE TYPE "SourceDataKind" AS ENUM ('IGI', 'GPZU', 'TOPO', 'GEOBASE', 'CONSTRAINTS');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "sourceDataKind" "SourceDataKind";
