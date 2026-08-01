-- Optional selection step shown after Package (e.g. Solar -> System Size) — fully data-driven.
ALTER TABLE "Service"
  ADD COLUMN "hasAdditionalSelection" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "additionalSelectionLabel" TEXT,
  ADD COLUMN "additionalSelectionDescription" TEXT;

CREATE TABLE "ServiceAdditionalOption" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "iconName" TEXT,
  "iconUrl" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceAdditionalOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceAdditionalOption_serviceId_idx" ON "ServiceAdditionalOption"("serviceId");

ALTER TABLE "ServiceAdditionalOption"
  ADD CONSTRAINT "ServiceAdditionalOption_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Booking" ADD COLUMN "additionalSelectionOptionId" TEXT;
CREATE INDEX "Booking_additionalSelectionOptionId_idx" ON "Booking"("additionalSelectionOptionId");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_additionalSelectionOptionId_fkey"
  FOREIGN KEY ("additionalSelectionOptionId") REFERENCES "ServiceAdditionalOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
