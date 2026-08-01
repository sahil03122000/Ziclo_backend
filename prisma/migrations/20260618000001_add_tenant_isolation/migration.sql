-- ============================================================
-- Migration: add_tenant_isolation
-- Adds organizationId to Task and Attendance with backfill
-- from createdBy/user.organizationId respectively.
-- Both columns are nullable so existing rows are preserved.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- Task
-- ──────────────────────────────────────────────────────────────

ALTER TABLE "Task" ADD COLUMN "organizationId" TEXT;

-- Backfill from the task creator's organization
UPDATE "Task" t
SET "organizationId" = u."organizationId"
FROM "User" u
WHERE t."createdById" = u.id
  AND u."organizationId" IS NOT NULL;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Task_organizationId_idx" ON "Task"("organizationId");

-- ──────────────────────────────────────────────────────────────
-- Attendance
-- ──────────────────────────────────────────────────────────────

ALTER TABLE "Attendance" ADD COLUMN "organizationId" TEXT;

-- Backfill from the attending user's organization
UPDATE "Attendance" a
SET "organizationId" = u."organizationId"
FROM "User" u
WHERE a."userId" = u.id
  AND u."organizationId" IS NOT NULL;

ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Attendance_organizationId_idx" ON "Attendance"("organizationId");
