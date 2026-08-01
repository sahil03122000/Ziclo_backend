-- AlterTable: additive, nullable — Mobile App's BannersService.findActive() has no `select`,
-- so it will simply receive one extra (harmless) field, never a breaking shape change.
ALTER TABLE "Banner" ADD COLUMN "buttonText" TEXT;

-- CreateTable
CREATE TABLE "WebsiteGalleryItem" (
  "id"           TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "image"        TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteGalleryItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteGalleryItem_isActive_idx" ON "WebsiteGalleryItem"("isActive");
CREATE INDEX "WebsiteGalleryItem_deletedAt_idx" ON "WebsiteGalleryItem"("deletedAt");
CREATE INDEX "WebsiteGalleryItem_displayOrder_idx" ON "WebsiteGalleryItem"("displayOrder");

-- CreateTable
CREATE TABLE "WebsiteWhyZiclo" (
  "id"           TEXT NOT NULL,
  "icon"         TEXT,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteWhyZiclo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteWhyZiclo_isActive_idx" ON "WebsiteWhyZiclo"("isActive");
CREATE INDEX "WebsiteWhyZiclo_deletedAt_idx" ON "WebsiteWhyZiclo"("deletedAt");
CREATE INDEX "WebsiteWhyZiclo_displayOrder_idx" ON "WebsiteWhyZiclo"("displayOrder");

-- CreateTable
CREATE TABLE "WebsiteAppShowcase" (
  "id"           TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "image"        TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteAppShowcase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteAppShowcase_isActive_idx" ON "WebsiteAppShowcase"("isActive");
CREATE INDEX "WebsiteAppShowcase_deletedAt_idx" ON "WebsiteAppShowcase"("deletedAt");
CREATE INDEX "WebsiteAppShowcase_displayOrder_idx" ON "WebsiteAppShowcase"("displayOrder");

-- CreateTable
CREATE TABLE "WebsiteDownloadLink" (
  "id"         TEXT NOT NULL DEFAULT 'singleton',
  "androidUrl" TEXT,
  "iosUrl"     TEXT,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"  TIMESTAMP(3),
  "createdBy"  TEXT,
  "updatedBy"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteDownloadLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteTestimonial" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "designation"  TEXT,
  "message"      TEXT NOT NULL,
  "rating"       INTEGER NOT NULL DEFAULT 5,
  "image"        TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteTestimonial_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteTestimonial_isActive_idx" ON "WebsiteTestimonial"("isActive");
CREATE INDEX "WebsiteTestimonial_deletedAt_idx" ON "WebsiteTestimonial"("deletedAt");
CREATE INDEX "WebsiteTestimonial_rating_idx" ON "WebsiteTestimonial"("rating");
CREATE INDEX "WebsiteTestimonial_displayOrder_idx" ON "WebsiteTestimonial"("displayOrder");

-- CreateTable
CREATE TABLE "WebsiteFaq" (
  "id"           TEXT NOT NULL,
  "question"     TEXT NOT NULL,
  "answer"       TEXT NOT NULL,
  "category"     TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteFaq_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteFaq_isActive_idx" ON "WebsiteFaq"("isActive");
CREATE INDEX "WebsiteFaq_deletedAt_idx" ON "WebsiteFaq"("deletedAt");
CREATE INDEX "WebsiteFaq_category_idx" ON "WebsiteFaq"("category");
CREATE INDEX "WebsiteFaq_displayOrder_idx" ON "WebsiteFaq"("displayOrder");

-- Seed default singleton so GET /website/download-links has real data immediately.
INSERT INTO "WebsiteDownloadLink" ("id", "updatedAt")
VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
