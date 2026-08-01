-- AlterEnum: AttendanceStatus gains missed-checkout-approval states
ALTER TYPE "AttendanceStatus" ADD VALUE 'PENDING_CHECKOUT';
ALTER TYPE "AttendanceStatus" ADD VALUE 'PRESENT';
ALTER TYPE "AttendanceStatus" ADD VALUE 'HALF_DAY';
ALTER TYPE "AttendanceStatus" ADD VALUE 'ABSENT';

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('MANUAL', 'MISSED_REQUEST');

-- CreateEnum
CREATE TYPE "MissedCheckoutRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MissedCheckoutApprovalLevel" AS ENUM ('MANAGER', 'ADMIN');

-- AlterTable
ALTER TABLE "Attendance"
  ADD COLUMN "checkoutStatus" "CheckoutStatus" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvalRemark" TEXT;

-- AddForeignKey
ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Attendance_status_idx" ON "Attendance"("status");

-- AlterTable
ALTER TABLE "AttendanceRule"
  ADD COLUMN "requireAdminAttendanceApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MissedCheckoutRequest" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "imageUrl" TEXT,
    "status" "MissedCheckoutRequestStatus" NOT NULL DEFAULT 'PENDING',
    "currentLevel" "MissedCheckoutApprovalLevel" NOT NULL,
    "managerDecision" "MissedCheckoutRequestStatus",
    "managerDecidedById" TEXT,
    "managerDecidedAt" TIMESTAMP(3),
    "managerRemark" TEXT,
    "adminDecision" "MissedCheckoutRequestStatus",
    "adminDecidedById" TEXT,
    "adminDecidedAt" TIMESTAMP(3),
    "adminRemark" TEXT,
    "approvedCheckOutTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissedCheckoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissedCheckoutRequest_attendanceId_idx" ON "MissedCheckoutRequest"("attendanceId");

-- CreateIndex
CREATE INDEX "MissedCheckoutRequest_requestedById_idx" ON "MissedCheckoutRequest"("requestedById");

-- CreateIndex
CREATE INDEX "MissedCheckoutRequest_status_idx" ON "MissedCheckoutRequest"("status");

-- CreateIndex
CREATE INDEX "MissedCheckoutRequest_currentLevel_idx" ON "MissedCheckoutRequest"("currentLevel");

-- AddForeignKey
ALTER TABLE "MissedCheckoutRequest" ADD CONSTRAINT "MissedCheckoutRequest_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCheckoutRequest" ADD CONSTRAINT "MissedCheckoutRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCheckoutRequest" ADD CONSTRAINT "MissedCheckoutRequest_managerDecidedById_fkey" FOREIGN KEY ("managerDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedCheckoutRequest" ADD CONSTRAINT "MissedCheckoutRequest_adminDecidedById_fkey" FOREIGN KEY ("adminDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
