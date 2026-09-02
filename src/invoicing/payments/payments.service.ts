import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ActivityAction, ActivityModule, AuditAction, InvoiceStatus, PaymentMethod, PaymentStatus, PaymentType, Prisma, TransactionStatus } from '@prisma/client';

import { ActivityLogService } from '../../activity-log/activity-log.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { VerifyRazorpayDto } from './dto/verify-razorpay.dto';
import { RazorpayService } from './razorpay.service';

const PAYMENT_INCLUDE: Prisma.PaymentInclude = {
  transactions: { orderBy: { createdAt: 'desc' } },
  invoice: { select: { id: true, invoiceNumber: true, total: true, status: true, customerId: true } },
};

const r2 = (n: number) => parseFloat(n.toFixed(2));
// Booking/payment amounts are whole rupees, not paise-precision decimals — r2 stays
// 2-decimal for GST line-item math elsewhere, this is only for amounts actually charged/stored.
const r0 = (n: number) => Math.round(n);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly razorpay: RazorpayService,
    private readonly auditLogs: AuditLogsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ─── Offline payment (CASH / CARD / UPI / BANK_TRANSFER) ─────────────────────

  async createPayment(dto: CreatePaymentDto, actor: AuthUser, orgId?: string) {
    const actorId = actor.id;
    if (dto.method === PaymentMethod.RAZORPAY) {
      throw new BadRequestException('Use POST /invoicing/payments/razorpay/order for Razorpay payments');
    }

    const invoice = await this.assertPayableInvoice(dto.invoiceId, orgId);
    if (dto.amount > r2(invoice.total - invoice.paidAmount)) {
      throw new BadRequestException(
        `Payment amount ₹${dto.amount} exceeds outstanding balance ₹${r2(invoice.total - invoice.paidAmount)}`,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: dto.invoiceId,
        amount: dto.amount,
        method: dto.method,
        status: PaymentStatus.SUCCESS,
        notes: dto.notes,
        paidAt: new Date(),
      },
      include: PAYMENT_INCLUDE,
    });

    await this.invoicesService.syncPaymentStatus(dto.invoiceId);

    this.auditLogs
      .log({ actorId, entityType: 'Payment', entityId: payment.id, action: AuditAction.CREATE, newValue: { invoiceId: dto.invoiceId, amount: dto.amount, method: dto.method } })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.PAYMENT_SUCCESS,
      module: ActivityModule.PAYMENT,
      description: `Payment of ₹${dto.amount} recorded via ${dto.method}`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id: payment.id, type: 'Payment' },
      metadata: { invoiceId: dto.invoiceId, amount: dto.amount, method: dto.method },
    });

    return { success: true, message: 'Payment recorded successfully', data: payment };
  }

  // ─── Queries ──────────────────────────────────────────────────────────────────

  async findAll(query: PaymentQueryDto, orgId?: string) {
    const { page = 1, limit = 20, invoiceId, status, method } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.PaymentWhereInput = {};

    if (invoiceId) where.invoiceId = invoiceId;
    if (status) where.status = status;
    if (method) where.method = method;

    // Derive org from the invoice's linked booking or customer
    if (orgId) {
      where.invoice = {
        OR: [
          { booking: { organizationId: orgId } },
          { customer: { organizationId: orgId } },
        ],
      };
    }

    const [payments, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({ where, include: PAYMENT_INCLUDE, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      success: true,
      data: { payments, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string, orgId?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException('Payment not found');
    if (orgId) await this.assertPaymentOrg(id, orgId);
    return { success: true, data: payment };
  }

  // ─── Razorpay: Create Order ───────────────────────────────────────────────────

  async createRazorpayOrder(dto: CreateRazorpayOrderDto, actorId: string, orgId?: string) {
    const t0 = Date.now();
    try {
      return await this.createRazorpayOrderInternal(dto, actorId, orgId, t0);
    } catch (err) {
      // Never swallowed — logged with elapsed time (so the last logged START/END pair above
      // pinpoints exactly which step was in flight) and rethrown as-is for the global exception
      // filter / caller to handle. This guarantees an HTTP response is always sent — the request
      // can never be left hanging past this point.
      this.logger.error(`[razorpay-order] FAILED after ${Date.now() - t0}ms: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }

  private async createRazorpayOrderInternal(dto: CreateRazorpayOrderDto, actorId: string, orgId: string | undefined, t0: number) {
    this.logger.debug(`[razorpay-order] amount calculation START (+${Date.now() - t0}ms) invoiceId=${dto.invoiceId}`);
    const invoice = await this.assertPayableInvoice(dto.invoiceId, orgId);
    // Whole rupees, not paise-precision decimals — the invoice total can carry fractional
    // cents from GST math (e.g. 399 + 18% = 470.82); round to the nearest rupee before this
    // becomes the amount actually charged via Razorpay, so the order is never created for a
    // fractional amount like ₹470.82.
    const outstanding = r0(invoice.total - invoice.paidAmount);
    const paymentType = dto.paymentType ?? PaymentType.FULL;
    const amountInPaise = outstanding * 100;
    // Sanitized — never logs any Razorpay credential. Total/Already Paid/Remaining are the
    // server-side authoritative figures (invoice.total, invoice.paidAmount — the live sum of
    // this invoice's SUCCESS payments); the Razorpay order is always created for exactly the
    // remaining amount, never a value supplied by the client.
    this.logger.debug(
      `[razorpay-order] amount calculation END (+${Date.now() - t0}ms) invoiceId=${dto.invoiceId} paymentType=${paymentType} ` +
        `total=${r0(invoice.total)} alreadyPaid=${r0(invoice.paidAmount)} remaining=${outstanding} razorpayOrderPaise=${amountInPaise}`,
    );

    if (outstanding <= 0) throw new BadRequestException('Invoice is already fully paid');

    // Idempotency: reuse an existing pending Razorpay order for this exact invoice/paymentType/
    // amount instead of creating a new one. This is what makes the endpoint safe against the
    // realistic duplicate-tap scenario the ~10s frontend timeout causes — the user sees no
    // response and presses "Pay" again while (or right after) the first attempt is still
    // completing. A matching PENDING Payment with a still-CREATED (not yet paid/failed)
    // Transaction means a valid order already exists — no need to call Razorpay again.
    this.logger.debug(`[razorpay-order] duplicate-order check START (+${Date.now() - t0}ms)`);
    const reusable = await this.prisma.payment.findFirst({
      where: { invoiceId: dto.invoiceId, method: PaymentMethod.RAZORPAY, status: PaymentStatus.PENDING, paymentType, amount: outstanding },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        transactions: {
          where: { status: TransactionStatus.CREATED },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { razorpayOrderId: true },
        },
      },
    });
    const reusableOrderId = reusable?.transactions[0]?.razorpayOrderId;
    if (reusableOrderId) {
      this.logger.debug(
        `[razorpay-order] duplicate-order check END (+${Date.now() - t0}ms) — reusing paymentId=${reusable!.id} razorpayOrderId=${reusableOrderId}`,
      );
      return {
        success: true,
        message: 'Razorpay order created',
        data: {
          paymentId: reusable!.id,
          razorpayOrderId: reusableOrderId,
          amount: amountInPaise,
          currency: 'INR',
          keyId: this.razorpay.getKeyId(),
          invoiceNumber: invoice.invoiceNumber,
          paymentType,
        },
      };
    }
    this.logger.debug(`[razorpay-order] duplicate-order check END (+${Date.now() - t0}ms) — no reusable order found`);

    // Presence-only — never log the actual key/secret values.
    this.logger.debug(
      `[razorpay-order] Razorpay configuration check (+${Date.now() - t0}ms) ` +
        `RAZORPAY_KEY_ID=${this.razorpay.hasKeyId() ? 'present' : 'MISSING'} ` +
        `RAZORPAY_KEY_SECRET=${this.razorpay.hasKeySecret() ? 'present' : 'MISSING'}`,
    );
    if (!this.razorpay.isConfigured()) {
      // Fail immediately with a clear status instead of calling createOrder() and letting it
      // discover mid-request that there's nothing to authenticate with — this is the difference
      // between a fast, explicit 503 and an HTTP call that has no chance of ever succeeding.
      this.logger.error('[razorpay-order] Razorpay is not configured — aborting before making a doomed API call');
      throw new ServiceUnavailableException('Razorpay payment gateway is not configured.');
    }

    this.logger.debug(`[razorpay-order] razorpay API START (+${Date.now() - t0}ms) amountInPaise=${amountInPaise}`);
    const order = await this.razorpay.createOrder(amountInPaise, invoice.invoiceNumber);
    this.logger.debug(`[razorpay-order] razorpay API END (+${Date.now() - t0}ms) razorpayOrderId=${order.id}`);

    // Only paymentId is ever read from this result (see the return below) — PAYMENT_INCLUDE
    // (transactions + invoice, used by the list/detail endpoints elsewhere in this file) forced
    // Prisma to do the insert then a follow-up joined SELECT to hydrate data nothing here uses.
    // `select: { id: true }` skips that entirely. This was the bulk of the ~2.17s payment step.
    this.logger.debug(`[razorpay-order] payment creation START (+${Date.now() - t0}ms)`);
    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: dto.invoiceId,
        amount: outstanding,
        method: PaymentMethod.RAZORPAY,
        status: PaymentStatus.PENDING,
        paymentType,
        transactions: {
          create: {
            razorpayOrderId: order.id,
            amount: outstanding,
            currency: 'INR',
            status: TransactionStatus.CREATED,
            rawPayload: order as unknown as Prisma.InputJsonValue,
          },
        },
      },
      select: { id: true },
    });
    this.logger.debug(`[razorpay-order] payment creation END (+${Date.now() - t0}ms) paymentId=${payment.id}`);

    this.auditLogs
      .log({ actorId, entityType: 'Payment', entityId: payment.id, action: AuditAction.CREATE, newValue: { invoiceId: dto.invoiceId, razorpayOrderId: order.id, paymentType } })
      .catch(() => {});

    return {
      success: true,
      message: 'Razorpay order created',
      data: {
        paymentId: payment.id,
        razorpayOrderId: order.id,
        amount: amountInPaise,
        currency: 'INR',
        keyId: this.razorpay.getKeyId(),
        invoiceNumber: invoice.invoiceNumber,
        paymentType,
      },
    };
  }

  // ─── Razorpay: Verify & Confirm ───────────────────────────────────────────────

  async verifyRazorpay(dto: VerifyRazorpayDto, actor: AuthUser, orgId?: string) {
    const t0 = Date.now();
    const actorId = actor.id;

    this.logger.debug(`[razorpay-verify] payment lookup START (+0ms) paymentId=${dto.paymentId}`);
    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
      include: {
        transactions: { where: { razorpayOrderId: dto.razorpayOrderId } },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            status: true,
            customerId: true,
            booking: { select: { organizationId: true, totalAmount: true, advanceAmount: true } },
            customer: { select: { organizationId: true } },
          },
        },
      },
    });
    this.logger.debug(`[razorpay-verify] payment lookup END (+${Date.now() - t0}ms) found=${!!payment} status=${payment?.status}`);

    if (!payment) throw new NotFoundException('Payment not found');

    // Org ownership check — reject cross-tenant verification attempts
    if (orgId) {
      const paymentOrg = payment.invoice.booking?.organizationId ?? payment.invoice.customer.organizationId;
      if (paymentOrg !== orgId) throw new NotFoundException('Payment not found');
    }

    // Idempotency: the client may retry after a timeout even though the backend already
    // finished (this is exactly the reported ERR_NETWORK-after-success symptom — the response
    // never arrived, so the app retries the same razorpayPaymentId). A previous version threw
    // a hard 400 "already processed" for ANY non-PENDING status, which meant a legitimate retry
    // of an already-SUCCESS verification got an error instead of the success payload it expects.
    // Re-serve the same result instead of erroring, and do it BEFORE the transaction/DB-write
    // work below runs — no duplicate Payment/Transaction row is ever created either way, since
    // this branch never reaches the write path.
    if (payment.status === PaymentStatus.SUCCESS) {
      const existingTxn = payment.transactions[0];
      if (existingTxn?.razorpayPaymentId === dto.razorpayPaymentId) {
        this.logger.debug(`[razorpay-verify] idempotent replay (+${Date.now() - t0}ms) — payment already SUCCESS, same razorpayPaymentId, re-serving result`);
        const alreadyVerified = await this.prisma.payment.findUnique({ where: { id: dto.paymentId }, include: PAYMENT_INCLUDE });
        return { success: true, message: 'Payment verified and confirmed', data: alreadyVerified };
      }
      // Same payment record but a DIFFERENT razorpayPaymentId being verified against it —
      // that's a genuine conflict, not a harmless retry.
      throw new BadRequestException('Payment has already been processed');
    }
    if (payment.status === PaymentStatus.FAILED) {
      throw new BadRequestException('Payment has already failed verification. Please retry payment from the start.');
    }
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException('Payment has already been processed');
    }
    if (!payment.transactions.length) {
      throw new BadRequestException('No transaction found for this Razorpay order');
    }

    this.logger.debug(`[razorpay-verify] signature verification START (+${Date.now() - t0}ms)`);
    const isValid = this.razorpay.verifyPaymentSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature);
    this.logger.debug(`[razorpay-verify] signature verification END (+${Date.now() - t0}ms) valid=${isValid}`);

    if (!isValid) {
      this.logger.debug(`[razorpay-verify] DB transaction START (+${Date.now() - t0}ms) — marking FAILED`);
      await this.prisma.$transaction([
        this.prisma.transaction.update({
          where: { razorpayOrderId: dto.razorpayOrderId },
          data: {
            status: TransactionStatus.FAILED,
            razorpayPaymentId: dto.razorpayPaymentId,
            errorDescription: 'Signature verification failed',
          },
        }),
        this.prisma.payment.update({ where: { id: dto.paymentId }, data: { status: PaymentStatus.FAILED } }),
      ]);
      this.logger.debug(`[razorpay-verify] DB transaction END (+${Date.now() - t0}ms)`);

      this.auditLogs
        .log({ actorId, entityType: 'Payment', entityId: dto.paymentId, action: AuditAction.UPDATE, newValue: { status: 'FAILED', reason: 'signature_mismatch' } })
        .catch(() => {});
      this.activityLog.log({
        action: ActivityAction.PAYMENT_FAILED,
        module: ActivityModule.PAYMENT,
        description: `Razorpay payment signature verification failed`,
        actor: { id: actor.id, name: actor.name, role: actor.role },
        target: { id: dto.paymentId, type: 'Payment' },
        metadata: { razorpayOrderId: dto.razorpayOrderId, reason: 'signature_mismatch' },
      });

      throw new BadRequestException('Payment signature verification failed. The payment could not be confirmed.');
    }

    // Expected amount for THIS transaction is exactly what the order was created for
    // (Payment.amount, written in createRazorpayOrderInternal from the server-computed
    // outstanding balance — never re-derived here, and never taken from the frontend/request
    // body, which carries no amount field at all). "Received" is Razorpay's own record of
    // what the order it created was for (Transaction.amount, saved verbatim from the Razorpay
    // order response at creation time) — Razorpay never issues a valid signature for a
    // payment_id that isn't actually the completed payment against that exact order, so this
    // comparison catches any drift between what we intended to charge and what actually got
    // recorded, without trusting either the client or a second Razorpay API round trip.
    const expectedAmount = r0(payment.amount);
    const receivedAmount = r0(payment.transactions[0]?.amount ?? payment.amount);
    const totalAmount = r0(payment.invoice.booking?.totalAmount ?? payment.amount);
    this.logger.debug(
      `[razorpay-verify] amount check paymentId=${dto.paymentId} bookingTotal=${totalAmount} ` +
        `expectedAmount=${expectedAmount} receivedAmount=${receivedAmount}`,
    );
    if (expectedAmount !== receivedAmount) {
      this.logger.error(
        `[razorpay-verify] AMOUNT MISMATCH paymentId=${dto.paymentId} expected=${expectedAmount} received=${receivedAmount} — refusing to confirm`,
      );
      throw new BadRequestException(`Payment amount mismatch (expected ₹${expectedAmount}). Please contact support before collecting payment.`);
    }

    // FULL: payable = the amount this order/transaction was actually created and charged for
    // (== expectedAmount — always the full CURRENT outstanding balance at order-creation time,
    // which after an earlier ADVANCE payment is only the remaining balance, not the booking's
    // original full total), remaining = 0 (a FULL order is always sized to fully settle the
    // account, so nothing is left once it succeeds).
    // ADVANCE: payable = the amount actually charged for the advance, remaining = total - payable
    // (derived from the actually-charged amount, never independently rounded, so payable +
    // remaining is always exactly totalAmount — no penny/rupee drift between the two).
    // Previously FULL always set paidAmount = the booking's whole totalAmount regardless of what
    // this transaction actually charged — correct for a first-time full payment, but wrong for a
    // FULL-type order created to collect a leftover balance after an ADVANCE (e.g. total ₹1000,
    // advance ₹623 already paid, this transaction only charges the remaining ₹377): paidAmount
    // was being recorded as ₹1000, double-counting the earlier advance.
    const paymentType = payment.paymentType ?? PaymentType.FULL;
    const paidAmount = expectedAmount;
    const remainingAmount = paymentType === PaymentType.ADVANCE ? totalAmount - paidAmount : 0;

    this.logger.debug(`[razorpay-verify] DB transaction START (+${Date.now() - t0}ms) — marking SUCCESS`);
    const [updatedTransaction, updatedPayment] = await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { razorpayOrderId: dto.razorpayOrderId },
        data: {
          status: TransactionStatus.PAID,
          razorpayPaymentId: dto.razorpayPaymentId,
          razorpaySignature: dto.razorpaySignature,
        },
      }),
      this.prisma.payment.update({
        where: { id: dto.paymentId },
        data: { status: PaymentStatus.SUCCESS, paidAt: new Date(), paidAmount, remainingAmount },
      }),
    ]);
    this.logger.debug(`[razorpay-verify] DB transaction END (+${Date.now() - t0}ms)`);

    // Non-blocking: Invoice.status (SENT -> PAID/PARTIALLY_PAID) is a secondary rollup the
    // client doesn't gate anything on in this response — the fields that matter (payment.status,
    // paidAmount, remainingAmount) are already committed and correct above. Previously this was
    // awaited plus a follow-up findUnique just to read the fresh status back — in production that
    // pair alone measured ~1.4s (see [razorpay-verify] invoice/payment update START/END in the
    // prior trace), entirely after the critical payment write had already succeeded. Running it
    // in the background means a slow/contended Invoice update can no longer add latency to an
    // already-successful payment response, and it can never turn that success into a client-side
    // failure (requirement: non-critical post-processing must not do that).
    this.invoicesService
      .syncPaymentStatus(payment.invoice.id)
      .catch((err: Error) => this.logger.error(`[razorpay-verify] syncPaymentStatus failed (non-fatal, background): ${err.message}`));

    // The response's `data` shape is the full PAYMENT_INCLUDE-hydrated payment object (existing
    // API contract, unchanged) — built here from data already in hand (the payment fetched at
    // the top of this method + the two update() results) instead of firing extra redundant
    // queries for a row whose contents are already fully known at this point. invoice.status is
    // the pre-payment value (e.g. SENT) since the sync above runs after this response is built;
    // it will read as PAID/PARTIALLY_PAID within moments on any subsequent fetch of this payment
    // or invoice — an acceptable, brief eventual-consistency window for this one derived field.
    this.logger.debug(`[razorpay-verify] response preparation START (+${Date.now() - t0}ms)`);
    const updated = {
      ...payment,
      ...updatedPayment,
      transactions: [{ ...payment.transactions[0], ...updatedTransaction }],
      invoice: {
        id: payment.invoice.id,
        invoiceNumber: payment.invoice.invoiceNumber,
        total: payment.invoice.total,
        status: payment.invoice.status,
        customerId: payment.invoice.customerId,
      },
    };
    this.logger.debug(`[razorpay-verify] response preparation END (+${Date.now() - t0}ms)`);

    this.auditLogs
      .log({ actorId, entityType: 'Payment', entityId: dto.paymentId, action: AuditAction.UPDATE, newValue: { status: 'SUCCESS', razorpayPaymentId: dto.razorpayPaymentId } })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.PAYMENT_SUCCESS,
      module: ActivityModule.PAYMENT,
      description: `Razorpay payment verified successfully`,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      target: { id: dto.paymentId, type: 'Payment' },
      metadata: { razorpayPaymentId: dto.razorpayPaymentId, invoiceId: payment.invoice.id },
    });

    this.logger.debug(`[razorpay-verify] RESPONSE (+${Date.now() - t0}ms total)`);
    return { success: true, message: 'Payment verified and confirmed', data: updated };
  }

  // ─── Refund ───────────────────────────────────────────────────────────────────

  async refund(id: string, actorId: string, orgId?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      select: { id: true, status: true, invoiceId: true, amount: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (orgId) await this.assertPaymentOrg(id, orgId);

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException('Only successful payments can be refunded');
    }

    await this.prisma.payment.update({ where: { id }, data: { status: PaymentStatus.REFUNDED } });

    const allPaid = await this.prisma.payment.findMany({
      where: { invoiceId: payment.invoiceId, status: PaymentStatus.SUCCESS },
      select: { amount: true },
    });
    const remainingPaid = allPaid.reduce((s, p) => s + p.amount, 0);

    if (remainingPaid <= 0) {
      await this.prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: InvoiceStatus.REFUNDED, paidAt: null },
      });
    } else {
      await this.invoicesService.syncPaymentStatus(payment.invoiceId);
    }

    this.auditLogs
      .log({ actorId, entityType: 'Payment', entityId: id, action: AuditAction.UPDATE, oldValue: { status: PaymentStatus.SUCCESS }, newValue: { status: PaymentStatus.REFUNDED } })
      .catch(() => {});

    const updated = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    return { success: true, message: 'Payment refunded successfully', data: updated };
  }

  // ─── Health check ─────────────────────────────────────────────────────────────

  getHealth() {
    return {
      success: true,
      data: {
        configured: this.razorpay.isConfigured(),
        mode: this.razorpay.getMode(),
      },
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  // Validates that the invoice exists, is payable, and (when orgId is provided)
  // belongs to the caller's organization. Returns invoice with computed paidAmount.
  private async assertPayableInvoice(invoiceId: string, orgId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        booking: { select: { organizationId: true } },
        customer: { select: { organizationId: true } },
        payments: { where: { status: PaymentStatus.SUCCESS }, select: { amount: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (orgId) {
      const invoiceOrg = invoice.booking?.organizationId ?? invoice.customer.organizationId;
      if (invoiceOrg !== orgId) throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) throw new BadRequestException('Cannot pay a cancelled invoice');
    if (invoice.status === InvoiceStatus.REFUNDED) throw new BadRequestException('Cannot pay a refunded invoice');
    if (invoice.status === InvoiceStatus.DRAFT) throw new BadRequestException('Invoice must be SENT before it can be paid');

    const paidAmount = r2(invoice.payments.reduce((s, p) => s + p.amount, 0));
    return { ...invoice, paidAmount };
  }

  // Resolves the org that owns a payment (via invoice → booking or customer) and
  // throws 404 if it doesn't match the caller's org. Using 404 (not 403) avoids
  // leaking the existence of cross-tenant resources.
  private async assertPaymentOrg(paymentId: string, orgId: string): Promise<void> {
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        invoice: {
          select: {
            booking: { select: { organizationId: true } },
            customer: { select: { organizationId: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Payment not found');
    const paymentOrg = row.invoice.booking?.organizationId ?? row.invoice.customer.organizationId;
    if (paymentOrg !== orgId) throw new NotFoundException('Payment not found');
  }
}
