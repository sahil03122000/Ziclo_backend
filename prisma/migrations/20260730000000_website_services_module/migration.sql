-- CreateTable
CREATE TABLE "Category" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "image"        TEXT,
  "icon"         TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "deletedAt"    TIMESTAMP(3),
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Category_isActive_idx" ON "Category"("isActive");
CREATE INDEX "Category_deletedAt_idx" ON "Category"("deletedAt");
CREATE INDEX "Category_displayOrder_idx" ON "Category"("displayOrder");

-- AlterTable: additive, nullable — no existing Service row or Mobile App query is affected.
ALTER TABLE "Service" ADD COLUMN "categoryId" TEXT;

CREATE INDEX "Service_categoryId_idx" ON "Service"("categoryId");

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
