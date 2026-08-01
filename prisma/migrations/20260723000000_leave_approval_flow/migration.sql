-- LeaveRequestStatus: add CANCELLED
ALTER TYPE "LeaveRequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- New enum for the leave two-level approval flow (mirrors MissedCheckoutApprovalLevel)
DO $$ BEGIN
  CREATE TYPE "LeaveApprovalLevel" AS ENUM ('MANAGER', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Retire the old, never-wired single-level reviewer fields
ALTER TABLE "WorkerLeaveRequest" DROP CONSTRAINT IF EXISTS "WorkerLeaveRequest_reviewedById_fkey";
ALTER TABLE "WorkerLeaveRequest" DROP COLUMN IF EXISTS "reviewedById";
ALTER TABLE "WorkerLeaveRequest" DROP COLUMN IF EXISTS "reviewedAt";
ALTER TABLE "WorkerLeaveRequest" DROP COLUMN IF EXISTS "reviewRemark";

-- New two-level approval fields
ALTER TABLE "WorkerLeaveRequest"
  ADD COLUMN "managerId" TEXT,
  ADD COLUMN "currentLevel" "LeaveApprovalLevel" NOT NULL DEFAULT 'MANAGER',
  ADD COLUMN "adminApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "managerDecision" "LeaveRequestStatus",
  ADD COLUMN "managerDecidedById" TEXT,
  ADD COLUMN "managerDecidedAt" TIMESTAMP(3),
  ADD COLUMN "managerRemark" TEXT,
  ADD COLUMN "adminDecision" "LeaveRequestStatus",
  ADD COLUMN "adminDecidedById" TEXT,
  ADD COLUMN "adminDecidedAt" TIMESTAMP(3),
  ADD COLUMN "adminRemark" TEXT;

CREATE INDEX "WorkerLeaveRequest_managerId_idx" ON "WorkerLeaveRequest"("managerId");

ALTER TABLE "WorkerLeaveRequest"
  ADD CONSTRAINT "WorkerLeaveRequest_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkerLeaveRequest"
  ADD CONSTRAINT "WorkerLeaveRequest_managerDecidedById_fkey"
  FOREIGN KEY ("managerDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkerLeaveRequest"
  ADD CONSTRAINT "WorkerLeaveRequest_adminDecidedById_fkey"
  FOREIGN KEY ("adminDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- LeavePolicy: global escalation toggle for the leave approval flow
ALTER TABLE "LeavePolicy" ADD COLUMN "requireAdminLeaveApproval" BOOLEAN NOT NULL DEFAULT false;
