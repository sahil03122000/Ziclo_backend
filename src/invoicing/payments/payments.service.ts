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
    this.logger.debug(`[razorpay-order] amount calculation END (+${Date.now() - t0}ms) outstanding=${outstanding}`);

    if (outstanding <= 0) throw new BadRequestException('Invoice is already fully paid');

    const paymentType = dto.paymentType ?? PaymentType.FULL;
    const amountInPaise = outstanding * 100;

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
    const actorId = actor.id;
    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
      include: {
        transactions: { where: { razorpayOrderId: dto.razorpayOrderId } },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            customerId: true,
            booking: { select: { organizationId: true, totalAmount: true, advanceAmount: true } },
            customer: { select: { organizationId: true } },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Payment not found');

    // Org ownership check — reject cross-tenant verification attempts
    if (orgId) {
      const paymentOrg = payment.invoice.booking?.organizationId ?? payment.invoice.customer.organizationId;
      if (paymentOrg !== orgId) throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException('Payment has already been processed');
    }
    if (!payment.transactions.length) {
      throw new BadRequestException('No transaction found for this Razorpay order');
    }

    const isValid = this.razorpay.verifyPaymentSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature);

    if (!isValid) {
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

    // FULL: payable = total, remaining = 0.
    // ADVANCE: payable = rounded advance amount, remaining = total - payable (derived from
    // the already-rounded payable, never independently rounded, so payable + remaining is
    // always exactly totalAmount — no penny/rupee drift between the two).
    const paymentType = payment.paymentType ?? PaymentType.FULL;
    const totalAmount = r0(payment.invoice.booking?.totalAmount ?? payment.amount);
    const advanceAmount = r0(payment.invoice.booking?.advanceAmount ?? totalAmount);
    const paidAmount = paymentType === PaymentType.ADVANCE ? advanceAmount : totalAmount;
    const remainingAmount = paymentType === PaymentType.ADVANCE ? totalAmount - paidAmount : 0;

    await this.prisma.$transaction([
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

    await this.invoicesService.syncPaymentStatus(payment.invoice.id);

    const updated = await this.prisma.payment.findUnique({ where: { id: dto.paymentId }, include: PAYMENT_INCLUDE });

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
