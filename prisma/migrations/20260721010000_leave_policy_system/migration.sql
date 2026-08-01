-- AlterEnum: LeaveType gains PLANNED
ALTER TYPE "LeaveType" ADD VALUE 'PLANNED';

-- CreateEnum
CREATE TYPE "LeaveTransactionType" AS ENUM ('ALLOCATION', 'CARRY_FORWARD', 'RESET', 'DEDUCTION', 'REFUND');

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "financialYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "financialYearEndMonth" INTEGER NOT NULL DEFAULT 3,
    "casualMonthlyAllocation" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "casualCarryForwardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "casualCarryForwardLimit" DOUBLE PRECISION,
    "casualFinancialYearReset" BOOLEAN NOT NULL DEFAULT true,
    "casualEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sickYearlyAllocation" DOUBLE PRECISION NOT NULL DEFAULT 6,
    "sickCarryForwardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sickCarryForwardLimit" DOUBLE PRECISION,
    "sickFinancialYearReset" BOOLEAN NOT NULL DEFAULT true,
    "sickEnabled" BOOLEAN NOT NULL DEFAULT true,
    "plannedMonthlyAllocation" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "plannedCarryForwardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "plannedCarryForwardLimit" DOUBLE PRECISION,
    "plannedFinancialYearReset" BOOLEAN NOT NULL DEFAULT false,
    "plannedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastMonthlyAllocationRunMonth" TEXT,
    "lastFinancialYearResetRunYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "casualAvailable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "casualUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sickAvailable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sickUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedAvailable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_userId_key" ON "LeaveBalance"("userId");

-- CreateIndex
CREATE INDEX "LeaveBalance_userId_idx" ON "LeaveBalance"("userId");

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LeaveTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "transactionType" "LeaveTransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveTransaction_userId_idx" ON "LeaveTransaction"("userId");

-- CreateIndex
CREATE INDEX "LeaveTransaction_leaveType_idx" ON "LeaveTransaction"("leaveType");

-- CreateIndex
CREATE INDEX "LeaveTransaction_createdAt_idx" ON "LeaveTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "LeaveTransaction" ADD CONSTRAINT "LeaveTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
