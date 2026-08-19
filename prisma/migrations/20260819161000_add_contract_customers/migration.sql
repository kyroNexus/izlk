CREATE TABLE "ContractCustomer" (
    "contractId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractCustomer_pkey" PRIMARY KEY ("contractId","contractorId")
);

CREATE INDEX "ContractCustomer_contractorId_idx" ON "ContractCustomer"("contractorId");

ALTER TABLE "ContractCustomer" ADD CONSTRAINT "ContractCustomer_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractCustomer" ADD CONSTRAINT "ContractCustomer_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
