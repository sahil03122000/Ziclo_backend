-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "dateKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("dateKey")
);
