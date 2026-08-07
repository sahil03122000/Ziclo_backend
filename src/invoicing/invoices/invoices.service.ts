import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, BookingStatus, InvoiceStatus, PaymentMethod, PaymentStatus, PaymentType, Prisma } from '@prisma/client';

import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AddInvoiceItemDto } from './dto/add-invoice-item.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceQueryDto } from './dto/invoice-query.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { UpdatePdfMetadataDto } from './dto/update-pdf-metadata.dto';

// ─── Select helpers ────────────────────────────────────────────────────────────

const USER_STUB = { id: true, name: true, email: true, phone: true, role: true } satisfies Prisma.UserSelect;

const INVOICE_INCLUDE: Prisma.InvoiceInclude = {
  items: { orderBy: { createdAt: 'asc' } },
  customer: { select: USER_STUB },
  createdBy: { select: USER_STUB },
  booking: {
    select: {
      id: true,
      scheduledAt: true,
      status: true,
      service: { select: { id: true, name: true } },
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
    include: { transactions: { orderBy: { createdAt: 'desc' } } },
  },
};

// ─── Math helpers ──────────────────────────────────────────────────────────────

const r2 = (n: number) => parseFloat(n.toFixed(2));

const MUTABLE_STATUSES: InvoiceStatus[] = [InvoiceStatus.DRAFT, InvoiceStatus.SENT];

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  // ─── Create ───────────────────────────────────────────────────────────────────

  async create(dto: CreateInvoiceDto, actorId: string) {
    const customer = await this.prisma.user.findUnique({ where: { id: dto.customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');

    if (dto.bookingId) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: dto.bookingId },
        select: { id: true, customerId: true, invoice: { select: { id: true } } },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.customerId !== dto.customerId) throw new BadRequestException('Booking does not belong to this customer');
      if (booking.invoice) throw new ConflictException('An invoice already exists for this booking');
    }

    const gstRate = dto.gstRate ?? 18;
    const discountAmount = dto.discountAmount ?? 0;
    const isInterState = dto.isInterState ?? false;

    const computedItems = dto.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate ?? gstRate,
      amount: r2(item.quantity * item.unitPrice),
    }));

    const taxes = this.computeTaxes(computedItems, discountAmount, gstRate, isInterState);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.generateInvoiceNumber(tx);
      return tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: dto.customerId,
          bookingId: dto.bookingId,
          createdById: actorId,
          gstRate,
          gstNumber: dto.gstNumber,
          isInterState,
          discountAmount,
          notes: dto.notes,
          dueDate: dto.dueDate,
          ...taxes,
          items: { create: computedItems },
        },
        include: INVOICE_INCLUDE,
      });
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: invoice.id, action: AuditAction.CREATE, newValue: { invoiceNumber: invoice.invoiceNumber, total: invoice.total } })
      .catch(() => {});

    return { success: true, message: 'Invoice created successfully', data: invoice };
  }

  // ─── Auto-generate from booking ───────────────────────────────────────────────

  async generateFromBooking(bookingId: string, actorId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        service: { select: { id: true, name: true } },
        invoice: { select: { id: true } },
      },
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('Invoice can only be auto-generated for COMPLETED bookings');
    }
    if (booking.invoice) throw new ConflictException('An invoice already exists for this booking');

    const gstRate = 18;
    const isInterState = false;
    const servicePrice = booking.packagePrice ?? booking.totalAmount ?? 0;
    const items = [
      {
        description: `${booking.service.name} — Service`,
        quantity: 1,
        unitPrice: servicePrice,
        taxRate: gstRate,
        amount: r2(servicePrice),
      },
    ];
    const taxes = this.computeTaxes(items, 0, gstRate, isInterState);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.generateInvoiceNumber(tx);
      return tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: booking.customerId,
          bookingId,
          createdById: actorId,
          gstRate,
          isInterState,
          discountAmount: 0,
          ...taxes,
          items: { create: items },
        },
        include: INVOICE_INCLUDE,
      });
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: invoice.id, action: AuditAction.CREATE, newValue: { invoiceNumber: invoice.invoiceNumber, bookingId, total: invoice.total } })
      .catch(() => {});

    this.notifications
      .notify(booking.customerId, 'Invoice Generated', `Invoice ${invoice.invoiceNumber} for ${booking.service.name} is ready.`, { invoiceId: invoice.id })
      .catch(() => {});

    return { success: true, message: 'Invoice generated from booking', data: invoice };
  }

  // Idempotent: creates (and immediately marks SENT/payable) a single-line invoice for a
  // booking's advanceAmount or totalAmount (per paymentType) if one doesn't exist yet.
  // If one already exists for a different amount and hasn't been paid yet, it's rebuilt for
  // the newly requested paymentType — used by the Booking Payment flow (paid online, before
  // the job runs), distinct from generateFromBooking above (the post-COMPLETED formal invoice).
  async ensureAdvanceInvoice(bookingId: string, actorId: string, paymentType: PaymentType = PaymentType.ADVANCE) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: { select: { name: true } }, invoice: { select: { id: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    // booking.totalAmount/advanceAmount are already GST-inclusive (BookingsService.create()
    // computes them the same way previewPrice() does — service price + tax, rounded to the
    // rupee), so this invoice must NOT apply GST again on top of them — that would silently
    // charge the customer tax-on-tax and desync the Razorpay order amount from what was
    // previewed/quoted. gstRate: 0 here means computeTaxes just carries the amount through.
    const gstRate = 0;
    const amount = paymentType === PaymentType.FULL
      ? booking.totalAmount ?? 0
      : booking.advanceAmount ?? booking.totalAmount ?? 0;
    const description = `${booking.service.name} — ${paymentType === PaymentType.FULL ? 'Full Payment' : 'Advance Payment'}`;
    const items = [{ description, quantity: 1, unitPrice: amount, taxRate: gstRate, amount: r2(amount) }];
    const taxes = this.computeTaxes(items, 0, gstRate, false);

    if (booking.invoice) {
      const existing = await this.prisma.invoice.findUnique({ where: { id: booking.invoice.id }, include: INVOICE_INCLUDE });
      if (!existing) throw new NotFoundException('Invoice not found');
      if (r2(existing.total) === r2(taxes.total)) return existing;

      const hasSuccessfulPayment = existing.payments.some((p) => p.status === PaymentStatus.SUCCESS);
      if (hasSuccessfulPayment || !MUTABLE_STATUSES.includes(existing.status)) {
        throw new BadRequestException('Invoice already has payments; cannot switch payment type');
      }

      await this.prisma.invoiceItem.deleteMany({ where: { invoiceId: existing.id } });
      return this.prisma.invoice.update({
        where: { id: existing.id },
        data: { ...taxes, items: { create: items } },
        include: INVOICE_INCLUDE,
      });
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.generateInvoiceNumber(tx);
      return tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: booking.customerId,
          bookingId,
          createdById: actorId,
          gstRate,
          isInterState: false,
          discountAmount: 0,
          status: InvoiceStatus.SENT,
          sentAt: new Date(),
          ...taxes,
          items: { create: items },
        },
        include: INVOICE_INCLUDE,
      });
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: invoice.id, action: AuditAction.CREATE, newValue: { invoiceNumber: invoice.invoiceNumber, bookingId, total: invoice.total, kind: paymentType } })
      .catch(() => {});

    return invoice;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────────

  async findAll(query: InvoiceQueryDto) {
    const { page = 1, limit = 20, status, customerId, invoiceNumber, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.InvoiceWhereInput = {};

    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (invoiceNumber) where.invoiceNumber = { contains: invoiceNumber, mode: 'insensitive' };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const [invoices, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, include: INVOICE_INCLUDE, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      success: true,
      data: { invoices, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findMy(customerId: string, query: InvoiceQueryDto) {
    const { page = 1, limit = 20, status, invoiceNumber, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.InvoiceWhereInput = { customerId };

    if (status) where.status = status;
    if (invoiceNumber) where.invoiceNumber = { contains: invoiceNumber, mode: 'insensitive' };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const [invoices, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, include: INVOICE_INCLUDE, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      success: true,
      data: { invoices, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return { success: true, data: invoice };
  }

  // ─── Mutations ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateInvoiceDto, actorId: string) {
    const invoice = await this.requireInvoice(id);
    this.assertMutable(invoice.status);

    const gstRate = dto.gstRate ?? invoice.gstRate;
    const discountAmount = dto.discountAmount ?? invoice.discountAmount;
    const isInterState = dto.isInterState ?? invoice.isInterState;

    const items = await this.prisma.invoiceItem.findMany({ where: { invoiceId: id } });
    const taxes = this.computeTaxes(items, discountAmount, gstRate, isInterState);

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        ...(dto.gstRate !== undefined && { gstRate }),
        ...(dto.isInterState !== undefined && { isInterState }),
        ...(dto.gstNumber !== undefined && { gstNumber: dto.gstNumber }),
        ...(dto.discountAmount !== undefined && { discountAmount }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.dueDate !== undefined && { dueDate: dto.dueDate }),
        ...taxes,
      },
      include: INVOICE_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: id, action: AuditAction.UPDATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Invoice updated successfully', data: updated };
  }

  async addItem(id: string, dto: AddInvoiceItemDto, actorId: string) {
    const invoice = await this.requireInvoice(id);
    this.assertMutable(invoice.status);

    const amount = r2(dto.quantity * dto.unitPrice);
    await this.prisma.invoiceItem.create({
      data: {
        invoiceId: id,
        description: dto.description,
        quantity: dto.quantity,
        unitPrice: dto.unitPrice,
        taxRate: dto.taxRate ?? invoice.gstRate,
        amount,
      },
    });

    await this.recalculateTotals(id);

    const updated = await this.prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: id, action: AuditAction.UPDATE, newValue: { addedItem: dto.description, amount } })
      .catch(() => {});

    return { success: true, message: 'Item added to invoice', data: updated };
  }

  async removeItem(invoiceId: string, itemId: string, actorId: string) {
    const invoice = await this.requireInvoice(invoiceId);
    this.assertMutable(invoice.status);

    const item = await this.prisma.invoiceItem.findFirst({ where: { id: itemId, invoiceId } });
    if (!item) throw new NotFoundException('Invoice item not found');

    const remaining = await this.prisma.invoiceItem.count({ where: { invoiceId } });
    if (remaining <= 1) throw new BadRequestException('Invoice must have at least one item');

    await this.prisma.invoiceItem.delete({ where: { id: itemId } });
    await this.recalculateTotals(invoiceId);

    const updated = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: INVOICE_INCLUDE });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: invoiceId, action: AuditAction.UPDATE, newValue: { removedItem: itemId } })
      .catch(() => {});

    return { success: true, message: 'Item removed from invoice', data: updated };
  }

  async send(id: string, actorId: string) {
    const invoice = await this.requireInvoice(id);
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be sent');
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.SENT, sentAt: new Date() },
      include: INVOICE_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: id, action: AuditAction.STATUS_CHANGE, oldValue: { status: InvoiceStatus.DRAFT }, newValue: { status: InvoiceStatus.SENT } })
      .catch(() => {});

    this.notifications
      .notify(invoice.customerId, 'Invoice Sent', `Invoice ${invoice.invoiceNumber} for ₹${invoice.total} is ready for payment.`, { invoiceId: id })
      .catch(() => {});

    return { success: true, message: 'Invoice sent successfully', data: updated };
  }

  async markOverdue(id: string, actorId: string) {
    const invoice = await this.requireInvoice(id);
    if (invoice.status !== InvoiceStatus.SENT) {
      throw new BadRequestException('Only SENT invoices can be marked overdue');
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.OVERDUE },
      include: INVOICE_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: id, action: AuditAction.STATUS_CHANGE, oldValue: { status: InvoiceStatus.SENT }, newValue: { status: InvoiceStatus.OVERDUE } })
      .catch(() => {});

    this.notifications
      .notify(invoice.customerId, 'Invoice Overdue', `Invoice ${invoice.invoiceNumber} for ₹${invoice.total} is overdue. Please pay immediately.`, { invoiceId: id })
      .catch(() => {});

    return { success: true, message: 'Invoice marked as overdue', data: updated };
  }

  async updatePdfMetadata(id: string, dto: UpdatePdfMetadataDto, actorId: string) {
    await this.requireInvoice(id);

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { pdfUrl: dto.pdfUrl, pdfGeneratedAt: new Date() },
      include: INVOICE_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: id, action: AuditAction.UPDATE, newValue: { pdfUrl: dto.pdfUrl } })
      .catch(() => {});

    return { success: true, message: 'PDF metadata updated', data: updated };
  }

  async cancel(id: string, actorId: string) {
    const invoice = await this.requireInvoice(id);
    if (invoice.status === InvoiceStatus.PAID) throw new BadRequestException('Cannot cancel a paid invoice');
    if (invoice.status === InvoiceStatus.CANCELLED) throw new BadRequestException('Invoice is already cancelled');

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
      include: INVOICE_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: id, action: AuditAction.STATUS_CHANGE, oldValue: { status: invoice.status }, newValue: { status: InvoiceStatus.CANCELLED } })
      .catch(() => {});

    return { success: true, message: 'Invoice cancelled', data: updated };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  async getStats() {
    const [byStatus, billedAgg, paidAgg, overdueAgg] = await Promise.all([
      this.prisma.invoice.groupBy({ by: ['status'], orderBy: { status: 'asc' }, _count: { _all: true }, _sum: { total: true } }),
      this.prisma.invoice.aggregate({ where: { status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.REFUNDED] } }, _sum: { total: true } }),
      this.prisma.invoice.aggregate({ where: { status: InvoiceStatus.PAID }, _sum: { total: true } }),
      this.prisma.invoice.aggregate({ where: { status: InvoiceStatus.OVERDUE }, _sum: { total: true } }),
    ]);

    const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, { count: s._count._all, amount: r2(s._sum?.total ?? 0) }]));
    const outstandingStatuses: InvoiceStatus[] = [InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];
    const totalOutstanding = r2(outstandingStatuses.reduce((s, st) => s + (statusMap[st]?.amount ?? 0), 0));
    const totalCount = Object.values(statusMap).reduce((s, v) => s + v.count, 0);

    return {
      success: true,
      data: {
        totalBilled: r2(billedAgg._sum.total ?? 0),
        totalPaid: r2(paidAgg._sum.total ?? 0),
        totalOutstanding,
        overdueAmount: r2(overdueAgg._sum.total ?? 0),
        counts: { total: totalCount, byStatus: statusMap },
      },
    };
  }

  // ─── Mark paid (ADMIN) ────────────────────────────────────────────────────────

  async markPaid(id: string, actorId: string) {
    const invoice = await this.requireInvoice(id);

    if (invoice.status === InvoiceStatus.CANCELLED) throw new BadRequestException('Cannot mark a CANCELLED invoice as paid');
    if (invoice.status === InvoiceStatus.REFUNDED) throw new BadRequestException('Cannot mark a REFUNDED invoice as paid');
    if (invoice.status === InvoiceStatus.PAID) throw new BadRequestException('Invoice is already PAID');

    const successPayments = await this.prisma.payment.findMany({
      where: { invoiceId: id, status: PaymentStatus.SUCCESS },
      select: { amount: true },
    });
    const alreadyPaid = r2(successPayments.reduce((s, p) => s + p.amount, 0));
    const outstanding = r2(invoice.total - alreadyPaid);

    if (outstanding > 0) {
      await this.prisma.payment.create({
        data: {
          invoiceId: id,
          amount: outstanding,
          method: PaymentMethod.CASH,
          status: PaymentStatus.SUCCESS,
          paidAt: new Date(),
          notes: 'Marked as paid by admin',
        },
      });
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.PAID, paidAt: new Date() },
      include: INVOICE_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Invoice', entityId: id, action: AuditAction.STATUS_CHANGE, oldValue: { status: invoice.status }, newValue: { status: InvoiceStatus.PAID, markedByAdmin: true } })
      .catch(() => {});

    return { success: true, message: 'Invoice marked as paid', data: updated };
  }

  // ─── PDF URL ──────────────────────────────────────────────────────────────────

  async getPdf(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, invoiceNumber: true, pdfUrl: true, pdfGeneratedAt: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.pdfUrl) throw new NotFoundException('PDF has not been generated for this invoice yet');

    return { success: true, data: { pdfUrl: invoice.pdfUrl, generatedAt: invoice.pdfGeneratedAt } };
  }

  // ─── Internal — called by PaymentsService ─────────────────────────────────────

  async syncPaymentStatus(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        total: true,
        status: true,
        payments: { where: { status: 'SUCCESS' }, select: { amount: true } },
      },
    });
    if (!invoice) return;
    if (invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.REFUNDED) return;

    const totalPaid = r2(invoice.payments.reduce((s, p) => s + p.amount, 0));
    let newStatus = invoice.status;

    if (totalPaid >= invoice.total) {
      newStatus = InvoiceStatus.PAID;
    } else if (totalPaid > 0) {
      newStatus = InvoiceStatus.PARTIALLY_PAID;
    }

    if (newStatus !== invoice.status) {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: newStatus, ...(newStatus === InvoiceStatus.PAID ? { paidAt: new Date() } : {}) },
      });
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private computeTaxes(
    items: { amount: number }[],
    discountAmount: number,
    gstRate: number,
    isInterState: boolean,
  ) {
    const subtotal = r2(items.reduce((s, i) => s + i.amount, 0));
    const taxableAmount = r2(Math.max(0, subtotal - discountAmount));
    const taxAmount = r2((taxableAmount * gstRate) / 100);
    const cgst = isInterState ? 0 : r2(taxAmount / 2);
    const sgst = isInterState ? 0 : r2(taxAmount / 2);
    const igst = isInterState ? taxAmount : 0;
    const total = r2(taxableAmount + taxAmount);
    return { subtotal, taxableAmount, taxAmount, cgst, sgst, igst, total };
  }

  // Concurrency-safe: previously this counted existing rows with `count()` and used
  // count+1 — under concurrent requests, two transactions could both count N and both try
  // to create invoiceNumber N+1, and the second one would fail with Prisma P2002 on the
  // unique constraint (exactly the reported bug). InvoiceCounter.seq is incremented via an
  // atomic upsert instead — Postgres row-locks that row for the increment, so two concurrent
  // callers can never be handed the same seq for the same day. A per-attempt existence check
  // plus retry loop is layered on top as a defensive backstop (e.g. against pre-existing rows
  // that don't follow this sequence), per the max-10-attempts requirement.
  private async generateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
    const now = new Date();
    const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    const MAX_ATTEMPTS = 10;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const counter = await tx.invoiceCounter.upsert({
        where: { dateKey },
        create: { dateKey, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      const candidate = `INVOICE-${dateKey}-${String(counter.seq).padStart(6, '0')}`;

      const existing = await tx.invoice.findUnique({ where: { invoiceNumber: candidate }, select: { id: true } });
      if (!existing) return candidate;

      this.logger.warn(`[generateInvoiceNumber] Candidate ${candidate} already exists (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying`);
    }

    throw new InternalServerErrorException('Unable to generate unique invoice number');
  }

  private async recalculateTotals(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { gstRate: true, isInterState: true, discountAmount: true, items: { select: { amount: true } } },
    });
    if (!invoice) return;
    const taxes = this.computeTaxes(invoice.items, invoice.discountAmount, invoice.gstRate, invoice.isInterState);
    await this.prisma.invoice.update({ where: { id: invoiceId }, data: taxes });
  }

  private async requireInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true, customerId: true, invoiceNumber: true, total: true, gstRate: true, isInterState: true, discountAmount: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  private assertMutable(status: InvoiceStatus): void {
    if (!MUTABLE_STATUSES.includes(status)) {
      throw new BadRequestException(`Cannot modify an invoice with status ${status}. Only DRAFT or SENT invoices are editable.`);
    }
  }
}
