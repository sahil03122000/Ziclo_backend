-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('SICK', 'CASUAL', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: worker job-flow fields on Booking (accept / start-location / payment collection)
ALTER TABLE "Booking"
  ADD COLUMN "workerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "workerStartAt" TIMESTAMP(3),
  ADD COLUMN "workerStartLatitude" DOUBLE PRECISION,
  ADD COLUMN "workerStartLongitude" DOUBLE PRECISION,
  ADD COLUMN "paymentCollectionMethod" "PaymentMethod",
  ADD COLUMN "paymentCollectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BookingPhoto" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "type" "TaskPhotoType" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingPhoto_bookingId_idx" ON "BookingPhoto"("bookingId");

-- AddForeignKey
ALTER TABLE "BookingPhoto" ADD CONSTRAINT "BookingPhoto_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "WorkerLeaveRequest" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "LeaveType" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewRemark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerLeaveRequest_workerId_idx" ON "WorkerLeaveRequest"("workerId");

-- CreateIndex
CREATE INDEX "WorkerLeaveRequest_status_idx" ON "WorkerLeaveRequest"("status");

-- CreateIndex
CREATE INDEX "WorkerLeaveRequest_date_idx" ON "WorkerLeaveRequest"("date");

-- AddForeignKey
ALTER TABLE "WorkerLeaveRequest" ADD CONSTRAINT "WorkerLeaveRequest_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerLeaveRequest" ADD CONSTRAINT "WorkerLeaveRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
