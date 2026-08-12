-- CreateTable
CREATE TABLE "AreaService" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AreaService_areaId_idx" ON "AreaService"("areaId");

-- CreateIndex
CREATE INDEX "AreaService_serviceId_idx" ON "AreaService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "AreaService_areaId_serviceId_key" ON "AreaService"("areaId", "serviceId");

-- AddForeignKey
ALTER TABLE "AreaService" ADD CONSTRAINT "AreaService_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaService" ADD CONSTRAINT "AreaService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
