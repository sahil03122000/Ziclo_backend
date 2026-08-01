-- CreateEnum
CREATE TYPE "PaymentCycle" AS ENUM ('MONTHLY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "WorkerProfile" ADD COLUMN "aadhaarFrontImage" TEXT;
ALTER TABLE "WorkerProfile" ADD COLUMN "aadhaarBackImage" TEXT;
ALTER TABLE "WorkerProfile" ADD COLUMN "paymentCycle" "PaymentCycle";
ALTER TABLE "WorkerProfile" ADD COLUMN "joiningDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkerCommission" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "commissionType" "CommissionType" NOT NULL,
    "commissionValue" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerCommission_workerId_serviceId_key" ON "WorkerCommission"("workerId", "serviceId");
CREATE INDEX "WorkerCommission_workerId_idx" ON "WorkerCommission"("workerId");
CREATE INDEX "WorkerCommission_serviceId_idx" ON "WorkerCommission"("serviceId");

-- AddForeignKey
ALTER TABLE "WorkerCommission" ADD CONSTRAINT "WorkerCommission_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkerCommission" ADD CONSTRAINT "WorkerCommission_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
