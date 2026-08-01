CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "halfDayHours" DOUBLE PRECISION NOT NULL,
    "fullDayHours" DOUBLE PRECISION NOT NULL,
    "lateAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "workingDays" INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shift_name_key" ON "Shift"("name");

CREATE INDEX "Shift_isActive_idx" ON "Shift"("isActive");

ALTER TABLE "ManagerProfile" ADD COLUMN "shiftId" TEXT;

CREATE INDEX "ManagerProfile_shiftId_idx" ON "ManagerProfile"("shiftId");

ALTER TABLE "ManagerProfile" ADD CONSTRAINT "ManagerProfile_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkerProfile" ADD COLUMN "shiftId" TEXT;

CREATE INDEX "WorkerProfile_shiftId_idx" ON "WorkerProfile"("shiftId");

ALTER TABLE "WorkerProfile" ADD CONSTRAINT "WorkerProfile_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
