-- AlterTable: new default for future rows
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- Backfill: existing bookings still literally PENDING but never actually paid are, under the
-- new semantics (PENDING_PAYMENT = unpaid, PENDING = paid/awaiting confirmation), really
-- PENDING_PAYMENT. Bookings already paid (or with no payment concept applicable) are untouched.
UPDATE "Booking"
SET "status" = 'PENDING_PAYMENT'
WHERE "status" = 'PENDING' AND "paymentStatus" != 'SUCCESS';
