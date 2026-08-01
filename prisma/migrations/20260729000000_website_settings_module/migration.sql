-- CreateTable
CREATE TABLE "WebsiteSettings" (
  "id"           TEXT NOT NULL DEFAULT 'singleton',
  "siteName"     TEXT NOT NULL DEFAULT 'Ziclo',
  "logoUrl"      TEXT,
  "faviconUrl"   TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "address"      TEXT,
  "facebookUrl"  TEXT,
  "instagramUrl" TEXT,
  "twitterUrl"   TEXT,
  "linkedinUrl"  TEXT,
  "youtubeUrl"   TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteHome" (
  "id"           TEXT NOT NULL DEFAULT 'singleton',
  "heroTitle"    TEXT,
  "heroSubtitle" TEXT,
  "heroImageUrl" TEXT,
  "heroCtaText"  TEXT,
  "heroCtaLink"  TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteHome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteStatistic" (
  "id"           TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "value"        TEXT NOT NULL,
  "iconName"     TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteStatistic_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteStatistic_isActive_idx" ON "WebsiteStatistic"("isActive");
CREATE INDEX "WebsiteStatistic_deletedAt_idx" ON "WebsiteStatistic"("deletedAt");
CREATE INDEX "WebsiteStatistic_displayOrder_idx" ON "WebsiteStatistic"("displayOrder");

-- CreateTable
CREATE TABLE "WebsiteSeo" (
  "id"           TEXT NOT NULL,
  "page"         TEXT NOT NULL,
  "title"        TEXT,
  "description"  TEXT,
  "keywords"     TEXT,
  "ogImage"      TEXT,
  "canonicalUrl" TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebsiteSeo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteSeo_page_key" ON "WebsiteSeo"("page");
CREATE INDEX "WebsiteSeo_page_idx" ON "WebsiteSeo"("page");
CREATE INDEX "WebsiteSeo_deletedAt_idx" ON "WebsiteSeo"("deletedAt");

-- Seed defaults so GET endpoints have real data immediately after deploy.
INSERT INTO "WebsiteSettings" ("id", "siteName", "updatedAt")
VALUES ('singleton', 'Ziclo', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "WebsiteHome" ("id", "updatedAt")
VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
