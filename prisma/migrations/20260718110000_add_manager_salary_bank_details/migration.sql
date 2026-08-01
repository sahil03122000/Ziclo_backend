-- CreateEnum
CREATE TYPE "ManagerEmploymentType" AS ENUM ('MONTHLY', 'COMMISSION');

-- AlterTable
ALTER TABLE "ManagerProfile" ADD COLUMN "employmentType" "ManagerEmploymentType";
ALTER TABLE "ManagerProfile" ADD COLUMN "monthlySalary" DECIMAL(12,2);
ALTER TABLE "ManagerProfile" ADD COLUMN "bankAccountHolder" TEXT;
ALTER TABLE "ManagerProfile" ADD COLUMN "bankName" TEXT;
ALTER TABLE "ManagerProfile" ADD COLUMN "bankBranch" TEXT;
ALTER TABLE "ManagerProfile" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "ManagerProfile" ADD COLUMN "bankIfsc" TEXT;
ALTER TABLE "ManagerProfile" ADD COLUMN "upiId" TEXT;
ALTER TABLE "ManagerProfile" ADD COLUMN "remarks" TEXT;
