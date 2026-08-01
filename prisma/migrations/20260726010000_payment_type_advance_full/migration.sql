-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('ADVANCE', 'FULL');

-- AlterTable
ALTER TABLE "Payment"
  ADD COLUMN "paymentType" "PaymentType",
  ADD COLUMN "paidAmount" DOUBLE PRECISION,
  ADD COLUMN "remainingAmount" DOUBLE PRECISION;
