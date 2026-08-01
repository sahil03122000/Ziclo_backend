import * as crypto from 'crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  BookingStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SubscriptionStatus,
  TransactionStatus,
  WebhookProvider,
  WebhookStatus,
} from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InvoicesService } from '../invoicing/invoices/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

// ─── Razorpay payload type stubs ──────────────────────────────────────────────

interface RazorpayPaymentEntity {
  id: string;
  order_id?: string;
  amount: number;
  currency: string;
  status: string;
  error_code?: string;
  error_description?: string;
}

interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

interface RazorpaySubscriptionEntity {
  id: string;
  plan_id: string;
  status: string;
  notes?: Record<string, string>;
}

interface RazorpayOrderEntity {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    refund?: { entity: RazorpayRefundEntity };
    subscription?: { entity: RazorpaySubscriptionEntity };
    order?: { entity: RazorpayOrderEntity };
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RazorpayWebhookService {
  private readonly logger = new Logger(RazorpayWebhookService.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
    config: ConfigService,
  ) {
    this.webhookSecret = config.get<string>('RAZORPAY_WEBHOOK_SECRET') ?? '';
  }

  // ─── Entry point ─────────────────────────────────────────────────────────────

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    this.logger.log('Webhook received');

    // 1. Signature verification
    if (!this.verifySignature(rawBody, signature)) {
      this.logger.warn('Razorpay webhook signature mismatch — rejecting');
      throw new UnauthorizedException('Webhook signature verification failed');
    }

    // 2. Parse body
    let parsed: RazorpayWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookPayload;
    } catch {
      throw new UnauthorizedException('Webhook body is not valid JSON');
    }

    const { event } = parsed;
    const externalId = this.extractExternalId(parsed);

    this.logger.log(`Signature verified — event: ${event}, externalId: ${externalId ?? 'no-id'}`);

    // 3. Idempotency check — find existing event
    const existing = await this.findExistingEvent(event, externalId);
    if (existing?.status === WebhookStatus.PROCESSED) {
      this.logger.log(`Webhook ${event}:${externalId ?? 'no-id'} already processed — skipping`);
      return;
    }

    // 4. Persist event record (upsert for retry safety)
    const webhookEvent = await this.upsertWebhookEvent(event, externalId, parsed as unknown as Prisma.InputJsonValue, existing);

    // 5. Dispatch to handler
    try {
      await this.dispatch(event, parsed);
      await this.markDone(webhookEvent.id, WebhookStatus.PROCESSED);
      this.logger.log(`Processing success — event: ${event}, webhookEventId: ${webhookEvent.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.markDone(webhookEvent.id, WebhookStatus.FAILED, message);
      this.logger.error(`Processing failure — event: ${event}, webhookEventId: ${webhookEvent.id}, error: ${message}`);
      throw err; // re-throw → 500 → Razorpay will retry
    }
  }

  // ─── Dispatcher ───────────────────────────────────────────────────────────────

  private async dispatch(event: string, payload: RazorpayWebhookPayload): Promise<void> {
    switch (event) {
      case 'payment.captured':       return this.onPaymentCaptured(payload);
      case 'payment.failed':         return this.onPaymentFailed(payload);
      case 'refund.processed':       return this.onRefundProcessed(payload);
      case 'subscription.activated': return this.onSubscriptionActivated(payload);
      case 'subscription.cancelled': return this.onSubscriptionCancelled(payload);
      case 'order.paid':             return this.onOrderPaid(payload);
      default:
        this.logger.log(`Unhandled Razorpay event "${event}" — stored, no action taken`);
    }
  }

  // ─── payment.captured ─────────────────────────────────────────────────────────

  private async onPaymentCaptured(payload: RazorpayWebhookPayload): Promise<void> {
    const entity = payload.payload.payment?.entity;
    if (!entity) return;

    const { id: razorpayPaymentId, order_id: razorpayOrderId } = entity;

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          ...(razorpayOrderId ? [{ razorpayOrderId }] : []),
          ...(razorpayPaymentId ? [{ razorpayPaymentId }] : []),
        ],
      },
      include: {
        payment: {
          select: {
            id: true, status: true, amount: true, paidAmount: true, paidAt: true, invoiceId: true,
            invoice: { select: { id: true, customerId: true, invoiceNumber: true, total: true, bookingId: true, booking: { select: { id: true, status: true, customerId: true, service: { select: { name: true } } } } } },
          },
        },
      },
    });

    if (!transaction) {
      this.logger.warn(`payment.captured: no transaction for orderId=${razorpayOrderId}`);
      return;
    }

    if (transaction.payment.status === PaymentStatus.SUCCESS) return; // idempotent

    const paidAt = new Date();

    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.PAID,
          razorpayPaymentId,
          rawPayload: entity as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.payment.update({
        where: { id: transaction.paymentId },
        data: { status: PaymentStatus.SUCCESS, paidAt },
      }),
    ]);

    await this.invoicesService.syncPaymentStatus(transaction.payment.invoiceId);

    // Keep the Booking in sync too — same PENDING_PAYMENT → PENDING transition as the
    // app-driven verify endpoints, so a payment confirmed purely via webhook (e.g. the
    // customer closed the app before the client-side verify call completed) still unblocks
    // the booking instead of leaving it stuck in PENDING_PAYMENT forever.
    const booking = transaction.payment.invoice?.booking;
    if (booking) {
      const shouldAdvance = booking.status === BookingStatus.PENDING_PAYMENT;
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: {
          ...(shouldAdvance && { status: BookingStatus.PENDING }),
          paymentStatus: PaymentStatus.SUCCESS,
          razorpayPaymentId,
          razorpayOrderId,
          paidAmount: transaction.payment.paidAmount ?? transaction.payment.amount,
          paidAt: transaction.payment.paidAt ?? paidAt,
          paymentMethod: PaymentMethod.RAZORPAY,
        },
      });
      if (shouldAdvance) {
        this.notifications
          .notify(booking.customerId, 'Payment Successful', `Payment received for your booking for ${booking.service.name}.`, { bookingId: booking.id })
          .catch(() => {});
      }
    }

    const inv = transaction.payment.invoice;
    if (inv) {
      this.notifications
        .notify(inv.customerId, 'Payment Successful', `Payment of ₹${entity.amount / 100} received for invoice ${inv.invoiceNumber}.`, { invoiceId: inv.id })
        .catch(() => {});
    }

    this.auditLogs
      .log({ entityType: 'Payment', entityId: transaction.paymentId, action: AuditAction.UPDATE, newValue: { status: PaymentStatus.SUCCESS, razorpayPaymentId, source: 'webhook' } })
      .catch(() => {});
  }

  // ─── payment.failed ───────────────────────────────────────────────────────────

  private async onPaymentFailed(payload: RazorpayWebhookPayload): Promise<void> {
    const entity = payload.payload.payment?.entity;
    if (!entity) return;

    const { id: razorpayPaymentId, order_id: razorpayOrderId, error_code, error_description } = entity;

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          ...(razorpayOrderId ? [{ razorpayOrderId }] : []),
          ...(razorpayPaymentId ? [{ razorpayPaymentId }] : []),
        ],
      },
      include: {
        payment: {
          select: { id: true, status: true, invoice: { select: { customerId: true, invoiceNumber: true, booking: { select: { id: true, status: true } } } } },
        },
      },
    });

    if (!transaction) {
      this.logger.warn(`payment.failed: no transaction for orderId=${razorpayOrderId}`);
      return;
    }

    if (transaction.payment.status === PaymentStatus.FAILED) return;

    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.FAILED,
          razorpayPaymentId,
          errorCode: error_code,
          errorDescription: error_description,
          rawPayload: entity as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.payment.update({
        where: { id: transaction.paymentId },
        data: { status: PaymentStatus.FAILED },
      }),
    ]);

    // Booking remains PENDING_PAYMENT (or whatever it already was) — only paymentStatus
    // reflects the failed attempt, mirroring verifyBookingPayment's failure branch.
    const failedBooking = transaction.payment.invoice?.booking;
    if (failedBooking) {
      await this.prisma.booking.update({
        where: { id: failedBooking.id },
        data: { paymentStatus: PaymentStatus.FAILED, razorpayPaymentId, razorpayOrderId },
      });
    }

    const inv = transaction.payment.invoice;
    if (inv) {
      this.notifications
        .notify(inv.customerId, 'Payment Failed', `Your payment for invoice ${inv.invoiceNumber} failed. Please try again.`, {})
        .catch(() => {});
    }

    this.auditLogs
      .log({ entityType: 'Payment', entityId: transaction.paymentId, action: AuditAction.UPDATE, newValue: { status: PaymentStatus.FAILED, error_code, source: 'webhook' } })
      .catch(() => {});
  }

  // ─── refund.processed ─────────────────────────────────────────────────────────

  private async onRefundProcessed(payload: RazorpayWebhookPayload): Promise<void> {
    const entity = payload.payload.refund?.entity;
    if (!entity) return;

    const { payment_id: razorpayPaymentId } = entity;

    const transaction = await this.prisma.transaction.findFirst({
      where: { razorpayPaymentId },
      include: {
        payment: { select: { id: true, status: true, invoiceId: true, invoice: { select: { id: true, customerId: true, invoiceNumber: true } } } },
      },
    });

    if (!transaction) {
      this.logger.warn(`refund.processed: no transaction for razorpayPaymentId=${razorpayPaymentId}`);
      return;
    }

    if (transaction.payment.status === PaymentStatus.REFUNDED) return;

    await this.prisma.payment.update({
      where: { id: transaction.paymentId },
      data: { status: PaymentStatus.REFUNDED },
    });

    // Sync invoice — check remaining paid amount
    const remaining = await this.prisma.payment.findMany({
      where: { invoiceId: transaction.payment.invoiceId, status: PaymentStatus.SUCCESS },
      select: { amount: true },
    });
    const totalRemaining = remaining.reduce((s, p) => s + p.amount, 0);

    if (totalRemaining <= 0) {
      await this.prisma.invoice.update({
        where: { id: transaction.payment.invoiceId },
        data: { status: InvoiceStatus.REFUNDED, paidAt: null },
      });
    } else {
      await this.invoicesService.syncPaymentStatus(transaction.payment.invoiceId);
    }

    const inv = transaction.payment.invoice;
    if (inv) {
      this.notifications
        .notify(inv.customerId, 'Refund Processed', `Your refund of ₹${entity.amount / 100} for invoice ${inv.invoiceNumber} has been processed.`, { invoiceId: inv.id })
        .catch(() => {});
    }

    this.auditLogs
      .log({ entityType: 'Payment', entityId: transaction.paymentId, action: AuditAction.UPDATE, newValue: { status: PaymentStatus.REFUNDED, refundId: entity.id, source: 'webhook' } })
      .catch(() => {});
  }

  // ─── subscription.activated ───────────────────────────────────────────────────

  private async onSubscriptionActivated(payload: RazorpayWebhookPayload): Promise<void> {
    const entity = payload.payload.subscription?.entity;
    if (!entity) return;

    const sub = await this.findSubscription(entity.id, entity.notes?.organizationId);
    if (!sub) {
      this.logger.warn(`subscription.activated: no matching subscription for razorpaySubId=${entity.id}`);
      return;
    }

    const now = new Date();
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        razorpaySubscriptionId: entity.id,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    this.auditLogs
      .log({ entityType: 'Subscription', entityId: sub.id, action: AuditAction.STATUS_CHANGE, oldValue: { status: sub.status }, newValue: { status: SubscriptionStatus.ACTIVE, source: 'webhook' } })
      .catch(() => {});
  }

  // ─── subscription.cancelled ───────────────────────────────────────────────────

  private async onSubscriptionCancelled(payload: RazorpayWebhookPayload): Promise<void> {
    const entity = payload.payload.subscription?.entity;
    if (!entity) return;

    const sub = await this.findSubscription(entity.id, entity.notes?.organizationId);
    if (!sub) {
      this.logger.warn(`subscription.cancelled: no matching subscription for razorpaySubId=${entity.id}`);
      return;
    }

    if (sub.status === SubscriptionStatus.CANCELLED) return;

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
        razorpaySubscriptionId: entity.id,
      },
    });

    this.auditLogs
      .log({ entityType: 'Subscription', entityId: sub.id, action: AuditAction.STATUS_CHANGE, oldValue: { status: sub.status }, newValue: { status: SubscriptionStatus.CANCELLED, source: 'webhook' } })
      .catch(() => {});
  }

  // ─── order.paid ───────────────────────────────────────────────────────────────

  private async onOrderPaid(payload: RazorpayWebhookPayload): Promise<void> {
    // order.paid always includes the payment entity — reuse captured handler (idempotent)
    return this.onPaymentCaptured(payload);
  }

  // ─── Signature verification ───────────────────────────────────────────────────

  private verifySignature(rawBody: Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      // Missing secret is a misconfiguration, not a recoverable condition.
      // Accepting webhooks without verification would allow anyone to forge
      // payment.captured events and fraudulently mark invoices as paid.
      this.logger.error(
        'RAZORPAY_WEBHOOK_SECRET is not configured — rejecting webhook. ' +
        'Set this environment variable before processing live payments.',
      );
      throw new UnauthorizedException(
        'Webhook signature verification is not configured. Set RAZORPAY_WEBHOOK_SECRET.',
      );
    }

    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(signature, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private extractExternalId(payload: RazorpayWebhookPayload): string | undefined {
    return (
      payload.payload.payment?.entity?.id ??
      payload.payload.refund?.entity?.id ??
      payload.payload.subscription?.entity?.id
    );
  }

  private async findExistingEvent(event: string, externalId: string | undefined) {
    if (!externalId) return null;
    return this.prisma.webhookEvent.findUnique({
      where: { provider_event_externalId: { provider: WebhookProvider.RAZORPAY, event, externalId } },
    });
  }

  private async upsertWebhookEvent(
    event: string,
    externalId: string | undefined,
    payload: Prisma.InputJsonValue,
    existing: { id: string; retries: number } | null,
  ) {
    if (existing) {
      return this.prisma.webhookEvent.update({
        where: { id: existing.id },
        data: { retries: { increment: 1 }, status: WebhookStatus.PENDING, error: null },
      });
    }

    if (externalId) {
      return this.prisma.webhookEvent.create({
        data: { provider: WebhookProvider.RAZORPAY, event, externalId, payload, status: WebhookStatus.PENDING },
      });
    }

    // No externalId — cannot use unique constraint; just create
    return this.prisma.webhookEvent.create({
      data: { provider: WebhookProvider.RAZORPAY, event, payload, status: WebhookStatus.PENDING },
    });
  }

  private async markDone(id: string, status: WebhookStatus, error?: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status,
        processedAt: status === WebhookStatus.PROCESSED ? new Date() : undefined,
        error: error ?? null,
      },
    });
  }

  private async findSubscription(razorpaySubId: string, organizationId?: string) {
    return this.prisma.subscription.findFirst({
      where: {
        OR: [
          { razorpaySubscriptionId: razorpaySubId },
          ...(organizationId ? [{ organizationId }] : []),
        ],
      },
      select: { id: true, status: true, organizationId: true },
    });
  }
}
