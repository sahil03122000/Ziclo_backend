-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('ADD', 'SUBTRACT');

-- AlterTable
ALTER TABLE "ServiceAdditionalOption"
  ADD COLUMN "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "adjustmentType" "AdjustmentType" NOT NULL DEFAULT 'ADD';
