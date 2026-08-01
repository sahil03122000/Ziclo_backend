-- CreateTable
-- One manager can be assigned to multiple office locations (in addition to the
-- legacy single ManagerProfile.officeLocationId, kept for backward compatibility).
CREATE TABLE "ManagerOfficeLocation" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "officeLocationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerOfficeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagerOfficeLocation_managerId_idx" ON "ManagerOfficeLocation"("managerId");

-- CreateIndex
CREATE INDEX "ManagerOfficeLocation_officeLocationId_idx" ON "ManagerOfficeLocation"("officeLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerOfficeLocation_managerId_officeLocationId_key" ON "ManagerOfficeLocation"("managerId", "officeLocationId");

-- AddForeignKey
ALTER TABLE "ManagerOfficeLocation" ADD CONSTRAINT "ManagerOfficeLocation_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "ManagerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerOfficeLocation" ADD CONSTRAINT "ManagerOfficeLocation_officeLocationId_fkey" FOREIGN KEY ("officeLocationId") REFERENCES "OfficeLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
