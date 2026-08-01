ALTER TABLE "MissedCheckoutRequest"
  ALTER COLUMN "reason" DROP NOT NULL,
  ALTER COLUMN "requestedCheckOutTime" DROP NOT NULL,
  ADD COLUMN "managerId" TEXT,
  ADD COLUMN "adminApprovalRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "MissedCheckoutRequest_attendanceId_key" ON "MissedCheckoutRequest"("attendanceId");
CREATE INDEX "MissedCheckoutRequest_managerId_idx" ON "MissedCheckoutRequest"("managerId");
DROP INDEX IF EXISTS "MissedCheckoutRequest_attendanceId_idx";

ALTER TABLE "MissedCheckoutRequest"
  ADD CONSTRAINT "MissedCheckoutRequest_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
