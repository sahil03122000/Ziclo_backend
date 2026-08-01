-- ─── PricingOption: new table ───────────────────────────────────────────────
CREATE TABLE "PricingOption" (
  "id"           TEXT NOT NULL,
  "packageId"    TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "price"        DOUBLE PRECISION NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PricingOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PricingOption_packageId_idx" ON "PricingOption"("packageId");

ALTER TABLE "PricingOption"
  ADD CONSTRAINT "PricingOption_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Data migration: ServiceAdditionalOption -> PricingOption ──────────────
-- Every existing Package gets one PricingOption per ServiceAdditionalOption that belonged
-- to its Service (the old model was Service-wide; the new one is Package-scoped, so the
-- same set of options is copied onto every Package under that Service). `price` collapses
-- the old finalPrice/amount+adjustmentType logic into a single final price, matching what
-- resolveServicePrice() used to compute at booking time.
INSERT INTO "PricingOption" ("id", "packageId", "label", "price", "displayOrder", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  pkg."id",
  sao."name",
  COALESCE(sao."finalPrice", pkg."price" + (CASE WHEN sao."adjustmentType" = 'SUBTRACT' THEN -sao."amount" ELSE sao."amount" END)),
  sao."displayOrder",
  sao."isActive",
  sao."createdAt",
  sao."updatedAt"
FROM "ServiceAdditionalOption" sao
JOIN "PropertyType" pt ON pt."serviceId" = sao."serviceId"
JOIN "Package" pkg ON pkg."propertyTypeId" = pt."id";

-- Every Package that has no PricingOption yet (its Service never had Additional Selection
-- options) gets a single default "Standard" option carrying its existing flat price forward,
-- so no package is ever left without a selectable price.
INSERT INTO "PricingOption" ("id", "packageId", "label", "price", "displayOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), pkg."id", 'Standard', pkg."price", 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Package" pkg
WHERE NOT EXISTS (SELECT 1 FROM "PricingOption" po WHERE po."packageId" = pkg."id");

-- ─── Booking: additionalSelectionOptionId -> pricingOptionId ───────────────
ALTER TABLE "Booking" ADD COLUMN "pricingOptionId" TEXT;

-- Preserve the exact option a customer picked, matched by (packageId, label = old option name).
UPDATE "Booking" b
SET "pricingOptionId" = po."id"
FROM "ServiceAdditionalOption" sao, "PricingOption" po
WHERE b."additionalSelectionOptionId" = sao."id"
  AND po."packageId" = b."packageId"
  AND po."label" = sao."name";

-- Any booking left without a match (no option was selected, or selection couldn't be
-- resolved) falls back to its package's first PricingOption — a display/reporting link only;
-- totalAmount/advanceAmount already stored on the booking are never recalculated, so no
-- existing booking's charged amount changes.
UPDATE "Booking" b
SET "pricingOptionId" = (
  SELECT po."id" FROM "PricingOption" po
  WHERE po."packageId" = b."packageId"
  ORDER BY po."displayOrder" ASC, po."createdAt" ASC
  LIMIT 1
)
WHERE b."pricingOptionId" IS NULL;

CREATE INDEX "Booking_pricingOptionId_idx" ON "Booking"("pricingOptionId");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_pricingOptionId_fkey"
  FOREIGN KEY ("pricingOptionId") REFERENCES "PricingOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Remove Additional Selection entirely ──────────────────────────────────
ALTER TABLE "Booking" DROP COLUMN "additionalSelectionOptionId";

DROP TABLE "ServiceAdditionalOption";

ALTER TABLE "Service"
  DROP COLUMN "hasAdditionalSelection",
  DROP COLUMN "additionalSelectionLabel",
  DROP COLUMN "additionalSelectionDescription";

DROP TYPE "AdjustmentType";
