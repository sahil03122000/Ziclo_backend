-- AlterTable: LeaveBalance — available -> allocated (gross, never decremented by usage) + LWP
ALTER TABLE "LeaveBalance" RENAME COLUMN "casualAvailable" TO "casualAllocated";
ALTER TABLE "LeaveBalance" RENAME COLUMN "sickAvailable" TO "sickAllocated";
ALTER TABLE "LeaveBalance" RENAME COLUMN "plannedAvailable" TO "plannedAllocated";
ALTER TABLE "LeaveBalance" ADD COLUMN "lwpUsed" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable: Attendance — missed-checkout flag (status is set to ABSENT directly, no longer
-- routed through the retired PENDING_CHECKOUT intermediate status)
ALTER TABLE "Attendance" ADD COLUMN "missedCheckout" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: MissedCheckoutRequest — the worker's own claimed check-out time, required at
-- request time (previously only the approver could set an arbitrary check-out time)
ALTER TABLE "MissedCheckoutRequest" ADD COLUMN "requestedCheckOutTime" TIMESTAMP(3);
UPDATE "MissedCheckoutRequest" SET "requestedCheckOutTime" = "createdAt" WHERE "requestedCheckOutTime" IS NULL;
ALTER TABLE "MissedCheckoutRequest" ALTER COLUMN "requestedCheckOutTime" SET NOT NULL;
