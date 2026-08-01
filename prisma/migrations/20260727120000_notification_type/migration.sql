-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'BOOKING_CREATED',
  'MANAGER_ASSIGNED',
  'WORKER_ASSIGNED',
  'WORKER_ACCEPTED',
  'WORK_STARTED',
  'WORK_COMPLETED'
);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "type" "NotificationType";

CREATE INDEX "Notification_type_idx" ON "Notification"("type");
