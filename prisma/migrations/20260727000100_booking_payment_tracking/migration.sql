-- AlterTable
ALTER TABLE "Booking"
  ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  ADD COLUMN "razorpayOrderId" TEXT,
  ADD COLUMN "razorpayPaymentId" TEXT,
  ADD COLUMN "razorpaySignature" TEXT,
  ADD COLUMN "paidAmount" DOUBLE PRECISION,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "paymentMethod" "PaymentMethod";
