/*
  Warnings:

  - You are about to drop the `ContractStageComment` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ContractStageComment" DROP CONSTRAINT "ContractStageComment_contractId_fkey";

-- DropTable
DROP TABLE "ContractStageComment";
