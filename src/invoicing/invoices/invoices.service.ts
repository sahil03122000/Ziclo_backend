import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, BookingStatus, InvoiceStatus, PaymentMethod, PaymentStatus, PaymentType, Prisma, Role } from '@prisma/client';
// Same PDF library reports.service.ts already uses for generated exports —
// no new PDF dependency introduced.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { cloudinary } from '../../uploads/cloudinary.config';
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
      // Payment-breakdown source fields — see computeBookingPaymentSummary in findOne().
      totalAmount: true,
      advanceAmount: true,
      paymentStatus: true,
      paymentMethod: true,
      paidAt: true,
      razorpayPaymentId: true,
      paymentCollectionMethod: true,
      paymentCollectedAt: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
    include: { transactions: { orderBy: { createdAt: 'desc' } } },
  },
};

// ensureAdvanceInvoice()'s only caller (BookingsService.createPaymentOrder) uses just
// invoice.id and invoice.total — the full INVOICE_INCLUDE above (items, customer, createdBy,
// booking+service, payments+transactions) forces Prisma into several extra joined round trips
// per call for data that's immediately discarded. This is the bulk of the ~4.6s invoice step.
const INVOICE_PAYMENT_ORDER_SELECT = {
  id: true,
  invoiceNumber: true,
  status: true,
  total: true,
  payments: { select: { status: true } },
} satisfies Prisma.InvoiceSelect;

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
    const t0 = Date.now();
    this.logger.debug(`[razorpay-order] invoice START (+0ms) bookingId=${bookingId} paymentType=${paymentType}`);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        customerId: true,
        totalAmount: true,
        advanceAmount: true,
        service: { select: { name: true } },
        invoice: { select: { id: true } },
      },
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

    // ensureAdvanceInvoice()'s only caller (BookingsService.createPaymentOrder) reads just
    // invoice.id and invoice.total — INVOICE_PAYMENT_ORDER_SELECT (id/invoiceNumber/status/
    // total/payments[status]) replaces the previous full INVOICE_INCLUDE (items, customer,
    // createdBy, booking+service, payments+transactions), which forced several extra joined
    // round trips per call for data nothing here ever used. This was the bulk of the ~4.6s
    // invoice step. INVOICE_INCLUDE is still used everywhere else that actually needs it.
    if (booking.invoice) {
      const existing = await this.prisma.invoice.findUnique({
        where: { id: booking.invoice.id },
        select: INVOICE_PAYMENT_ORDER_SELECT,
      });
      if (!existing) throw new NotFoundException('Invoice not found');
      if (r2(existing.total) === r2(taxes.total)) {
        this.logger.debug(`[razorpay-order] invoice END (+${Date.now() - t0}ms) reused existing invoiceId=${existing.id}`);
        return existing;
      }

      const hasSuccessfulPayment = existing.payments.some((p) => p.status === PaymentStatus.SUCCESS);
      if (hasSuccessfulPayment || !MUTABLE_STATUSES.includes(existing.status)) {
        throw new BadRequestException('Invoice already has payments; cannot switch payment type');
      }

      await this.prisma.invoiceItem.deleteMany({ where: { invoiceId: existing.id } });
      const updated = await this.prisma.invoice.update({
        where: { id: existing.id },
        data: { ...taxes, items: { create: items } },
        select: INVOICE_PAYMENT_ORDER_SELECT,
      });
      this.logger.debug(`[razorpay-order] invoice END (+${Date.now() - t0}ms) rebuilt invoiceId=${updated.id}`);
      return updated;
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
        select: INVOICE_PAYMENT_ORDER_SELECT,
      });
    });
    this.logger.debug(`[razorpay-order] invoice END (+${Date.now() - t0}ms) created invoiceId=${invoice.id}`);

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

    // Additive — invoice.total/items are unchanged (still whatever was actually invoiced, e.g.
    // just the advance for an ADVANCE-type invoice). paymentSummary is the real booking-level
    // payment state (Total/Advance/Paid/Remaining/status/method/txn) — never advanceAmount
    // mistaken for paidAmount. Same derivation BookingsService.getSummary() and the PDF use.
    const successPayments = invoice.payments.filter((p) => p.status === PaymentStatus.SUCCESS);
    const paymentSummary = this.computeBookingPaymentSummary(invoice.booking, successPayments);

    return { success: true, data: { ...invoice, paymentSummary } };
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

  // Root cause of "invoice download doesn't work": pdfUrl/pdfGeneratedAt were being written
  // for a PDF generated onto *local disk* (exports/invoices/<file>.pdf), served back via a
  // BASE_URL-prefixed static path. That's fine on a single long-lived box, but this app deploys
  // to an ephemeral filesystem (see ImageUploadController's "no file is ever written to local/
  // Railway disk" — the same constraint applies here) — any restart/redeploy wipes the exports/
  // directory, so a pdfUrl generated by one process instance 404s forever once a different
  // instance serves the request, even though the DB row still says "generated". Fixed by
  // generating the PDF into memory and uploading it to Cloudinary (this app's actual durable
  // asset store, already used for every other generated/uploaded file — see cloudinary.config.ts)
  // instead of local disk, so pdfUrl is a real, persistent Cloudinary URL. No new storage
  // dependency introduced — reuses the same `cloudinary` client and `invoices` folder the
  // upload allowlist already reserves (see VALID_UPLOAD_FOLDERS in uploads.service.ts).
  // Root cause of "PDF download is not working": Cloudinary's Admin API signs
  // private_download_url with a `timestamp` that it rejects as a "stale request" once more than
  // 1 hour old (confirmed live — a URL generated hours earlier now 400s with exactly that
  // message). The previous version generated this URL ONCE and cached it permanently in
  // Invoice.pdfUrl, so every download attempt after that first hour was permanently broken,
  // regardless of platform. Fixed by treating pdfGeneratedAt (not pdfUrl) as "has the file
  // already been uploaded to Cloudinary" — the actual PDF asset is uploaded at most once (its
  // Cloudinary public_id is fully deterministic: `ziclo/invoices/invoice-<invoiceNumber>`, no
  // need to store it separately), but the signed download URL is regenerated fresh on every
  // call — a local HMAC computation, no network round trip, so this is cheap.
  async getPdf(id: string, actor?: { id: string; role: Role }) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, invoiceNumber: true, pdfGeneratedAt: true, customerId: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (actor?.role === Role.USER && invoice.customerId !== actor.id) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.pdfGeneratedAt) {
      const pdfUrl = this.buildInvoicePdfDownloadUrl(invoice.invoiceNumber);
      await this.prisma.invoice.update({ where: { id }, data: { pdfUrl } });
      return { success: true, data: { invoiceNumber: invoice.invoiceNumber, pdfUrl, generatedAt: invoice.pdfGeneratedAt } };
    }

    // Own narrow `select` (not INVOICE_INCLUDE) — precisely typed for exactly
    // what the PDF needs, side-stepping INVOICE_INCLUDE's widened `: Prisma.
    // InvoiceInclude` annotation losing its nested `booking.select.service`
    // shape. Also pulls in the same booking payment fields getSummary() uses, so the PDF can
    // print the real payment breakdown (Total/Advance/Paid/Remaining/status/method/txn), not
    // just the invoice's own line items/total (which, for an ADVANCE-type invoice, is only the
    // advance portion — see ensureAdvanceInvoice).
    const full = await this.prisma.invoice.findUnique({
      where: { id },
      select: {
        invoiceNumber: true,
        createdAt: true,
        subtotal: true,
        discountAmount: true,
        cgst: true,
        sgst: true,
        igst: true,
        isInterState: true,
        total: true,
        customer: { select: { name: true, email: true, phone: true } },
        booking: {
          select: {
            id: true,
            bookingRef: true,
            scheduledAt: true,
            service: { select: { name: true } },
            timeSlot: { select: { startTime: true, endTime: true } },
            totalAmount: true,
            advanceAmount: true,
            paymentStatus: true,
            paymentMethod: true,
            paidAt: true,
            razorpayPaymentId: true,
            paymentCollectionMethod: true,
            paymentCollectedAt: true,
          },
        },
        items: { select: { description: true, quantity: true, unitPrice: true, amount: true }, orderBy: { createdAt: 'asc' } },
        payments: {
          where: { status: PaymentStatus.SUCCESS },
          select: { amount: true, method: true, paidAt: true, transactions: { select: { razorpayPaymentId: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
          orderBy: { paidAt: 'desc' },
        },
      },
    });
    if (!full) throw new NotFoundException('Invoice not found');

    const paymentSummary = this.computeBookingPaymentSummary(full.booking, full.payments);

    let pdfUrl: string;
    try {
      const buffer = await this.generateInvoicePdfBuffer(full, paymentSummary);
      const publicId = await this.uploadInvoicePdfToCloudinary(buffer, full.invoiceNumber);
      pdfUrl = this.buildInvoicePdfDownloadUrl(publicId);
    } catch (err) {
      this.logger.error('[InvoicesService] PDF generation/upload failed:', err as Error);
      throw new InternalServerErrorException('Unable to generate invoice PDF.');
    }

    const generatedAt = new Date();
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { pdfUrl, pdfGeneratedAt: generatedAt },
      select: { invoiceNumber: true, pdfUrl: true, pdfGeneratedAt: true },
    });

    return {
      success: true,
      data: { invoiceNumber: updated.invoiceNumber, pdfUrl: updated.pdfUrl, generatedAt: updated.pdfGeneratedAt },
    };
  }

  // GET :id/pdf must hand the browser genuine PDF bytes directly (Content-Type: application/pdf,
  // Content-Disposition: attachment) — not a JSON envelope with a URL the browser has to make a
  // second, separate request to. Reuses getPdf() as-is for the existing generate-if-missing +
  // fresh-signed-URL + authorization logic (unchanged), then fetches those bytes server-side
  // (the Cloudinary Admin API signature never leaves the backend) and validates them before
  // handing them to the client. Regenerates exactly once, per "if stored PDF is invalid:
  // regenerate it" — covers BOTH ways a cached asset can be invalid: the fetch itself failing
  // (e.g. the underlying Cloudinary asset was deleted/never actually uploaded — root cause of a
  // stale DB row confirming "generated" for an asset that no longer exists) and the fetch
  // succeeding with bytes that aren't actually a PDF (corrupted/incomplete prior upload).
  // Previously only the second case triggered regeneration — the first fell straight through to
  // a hard 500, the exact "stale/missing stored PDF" gap this method now closes.
  async streamPdf(id: string, actor: { id: string; role: Role } | undefined): Promise<{ buffer: Buffer; filename: string }> {
    const result = await this.getPdf(id, actor);
    const invoiceNumber = result.data.invoiceNumber;
    // invoiceNumber is already formatted "INVOICE-YYYYMMDD-NNNNNN" (see generateInvoiceNumber)
    // — avoid a redundant "INVOICE-INVOICE-..." filename when it already carries the prefix.
    const filename = /^invoice-/i.test(invoiceNumber) ? `${invoiceNumber}.pdf` : `INVOICE-${invoiceNumber}.pdf`;

    let buffer = await this.tryFetchPdfBytes(result.data.pdfUrl!);
    if (!buffer || !this.looksLikePdf(buffer)) {
      this.logger.warn(`[InvoicesService] Cached PDF for invoice ${id} was missing/invalid — regenerating`);
      await this.prisma.invoice.update({ where: { id }, data: { pdfUrl: null, pdfGeneratedAt: null } });
      const regenerated = await this.getPdf(id, actor);
      buffer = await this.tryFetchPdfBytes(regenerated.data.pdfUrl!);
      if (!buffer || !this.looksLikePdf(buffer)) {
        throw new InternalServerErrorException('Unable to generate invoice PDF.');
      }
    }

    return { buffer, filename };
  }

  private looksLikePdf(buffer: Buffer): boolean {
    return buffer.length > 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF';
  }

  // Never throws — a failed/non-ok fetch returns null so the caller can treat it exactly like
  // an invalid buffer (regenerate), rather than only handling "fetched successfully but wrong
  // content" and hard-failing on "couldn't fetch at all".
  private async tryFetchPdfBytes(url: string): Promise<Buffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(`[InvoicesService] PDF fetch returned ${response.status}: ${await response.text().catch(() => '')}`);
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      this.logger.warn(`[InvoicesService] Failed to fetch PDF bytes: ${(err as Error).message}`);
      return null;
    }
  }

  // Signed Admin-API download URL, freshly computed every call (see getPdf's comment on why —
  // these expire ~1hr after generation). `invoiceNumber` alone is enough since the Cloudinary
  // public_id is fully deterministic (see uploadInvoicePdfToCloudinary).
  private buildInvoicePdfDownloadUrl(invoiceNumberOrPublicId: string): string {
    const publicId = invoiceNumberOrPublicId.startsWith('ziclo/invoices/')
      ? invoiceNumberOrPublicId
      : `ziclo/invoices/invoice-${invoiceNumberOrPublicId}`;
    return cloudinary.utils.private_download_url(publicId, 'pdf', {
      resource_type: 'image',
      type: 'authenticated',
    });
  }

  // Uploads a generated PDF buffer to Cloudinary and returns its public_id (not a URL — see
  // buildInvoicePdfDownloadUrl, which must be called fresh on every read since the signed
  // download URL this account requires expires ~1hr after it's generated).
  //
  // This Cloudinary account has "Restricted media types" security enabled (an account-wide
  // dashboard setting) — confirmed live that it blocks ALL delivery of any .pdf asset (both
  // resource_type 'raw' and 'image', and both public 'upload' and signed 'authenticated'
  // delivery all 401 with `x-cld-error: deny or ACL failure`), even though the plain PNG
  // uploads this same app already does elsewhere deliver fine. The one path that does work is
  // the Admin API's private_download_url — an admin-authenticated (api_key+secret-signed)
  // download endpoint, not the public delivery CDN, so it isn't subject to that restriction;
  // verified live to return the exact real PDF bytes (%PDF header, correct byte count).
  private uploadInvoicePdfToCloudinary(buffer: Buffer, invoiceNumber: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'ziclo/invoices', public_id: `invoice-${invoiceNumber}`, resource_type: 'image', format: 'pdf', type: 'authenticated' },
        (error, result) => {
          if (error || !result) return reject(error ?? new Error('Cloudinary upload returned no result'));
          resolve(result.public_id);
        },
      );
      uploadStream.end(buffer);
    });
  }

  // Same paidAmount/remainingAmount/status/method/transactionId derivation
  // BookingsService.getSummary() already uses (that logic lives in a different module —
  // InvoicingModule can't import BookingsModule, BookingsModule already imports this one —
  // so it's re-applied here directly against the same Booking columns, not re-invented).
  // paidAmount is NEVER advanceAmount — it's the real sum of SUCCESS payments recorded against
  // this invoice, or the full total if the worker's in-person cash/QR collection settled it
  // (paymentCollectedAt set).
  private computeBookingPaymentSummary(
    booking: {
      totalAmount: number | null;
      advanceAmount: number | null;
      paymentStatus: string;
      paymentMethod: string | null;
      paidAt: Date | null;
      razorpayPaymentId: string | null;
      paymentCollectionMethod: string | null;
      paymentCollectedAt: Date | null;
    } | null,
    successPayments: {
      amount: number;
      method: string;
      paidAt: Date | null;
      transactions?: { razorpayPaymentId: string | null }[];
    }[],
  ) {
    const totalAmount = Math.round(booking?.totalAmount ?? 0);
    const onlinePaid = Math.round(successPayments.reduce((sum, p) => sum + p.amount, 0));
    const paidAmount = booking?.paymentCollectedAt ? totalAmount : onlinePaid;
    const remainingAmount = Math.max(0, totalAmount - paidAmount);
    const latestPayment = successPayments[0];

    // Derived summary bucket — distinct from `status` (booking.paymentStatus, the raw Razorpay-
    // specific CREATED/PENDING/SUCCESS/FAILED/REFUNDED enum). Reuses the exact same PAID/
    // PARTIALLY_PAID wording InvoiceStatus/syncPaymentStatus already use for the identical
    // paid-vs-total comparison — not a new persisted enum, just this same computation labeled
    // for direct display (InvoiceStatus has no bespoke "nothing paid yet" member, so that one
    // case is UNPAID here, informational only, never written to the database).
    const paymentStatus =
      totalAmount > 0 && paidAmount >= totalAmount ? 'PAID' : paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

    return {
      totalAmount,
      advanceAmount: booking?.advanceAmount ?? null,
      paidAmount,
      remainingAmount,
      paymentStatus,
      status: booking?.paymentStatus ?? null,
      method: latestPayment?.method ?? booking?.paymentMethod ?? null,
      paidAt: latestPayment?.paidAt ?? booking?.paidAt ?? null,
      transactionId: latestPayment?.transactions?.[0]?.razorpayPaymentId ?? booking?.razorpayPaymentId ?? null,
      paymentCollectionMethod: booking?.paymentCollectionMethod ?? null,
      paymentCollectedAt: booking?.paymentCollectedAt ?? null,
    };
  }

  // Real invoice data only — customer, booking/service, line items, and the
  // same subtotal/discount/tax/total columns findOne()/the frontend already
  // read. No placeholder text, no fabricated line items.
  //
  // Typed by hand (not Prisma.InvoiceGetPayload<{include: typeof
  // INVOICE_INCLUDE}>) — INVOICE_INCLUDE is declared `: Prisma.InvoiceInclude`,
  // which widens its `typeof` back to the general interface and loses the
  // nested `booking.select.service` shape GetPayload needs to type it.
  private async generateInvoicePdfBuffer(
    invoice: {
      invoiceNumber: string;
      createdAt: Date;
      subtotal: number;
      discountAmount: number;
      cgst: number;
      sgst: number;
      igst: number;
      isInterState: boolean;
      total: number;
      customer: { name: string; email: string; phone: string } | null;
      booking: {
        id: string;
        bookingRef: string | null;
        scheduledAt: Date;
        service: { name: string };
        timeSlot: { startTime: string; endTime: string } | null;
      } | null;
      items: { description: string; quantity: number; unitPrice: number; amount: number }[];
    },
    paymentSummary: {
      totalAmount: number;
      advanceAmount: number | null;
      paidAmount: number;
      remainingAmount: number;
      paymentStatus: string;
      method: string | null;
      paidAt: Date | null;
      transactionId: string | null;
    },
  ): Promise<Buffer> {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.rect(0, 0, doc.page.width, 70).fill('#1F4E79');
    doc.fill('white').fontSize(20).font('Helvetica-Bold').text('INVOICE', 40, 18, { lineBreak: false });
    doc.fontSize(10).font('Helvetica').text('Ziclo — Tax Invoice', 40, 42, { lineBreak: false });
    doc.fill('#000000');

    doc.moveDown(3);
    doc.font('Helvetica-Bold').fontSize(10).text('Invoice Number: ', { continued: true }).font('Helvetica').text(invoice.invoiceNumber);
    doc.font('Helvetica-Bold').text('Invoice Date: ', { continued: true }).font('Helvetica').text(invoice.createdAt.toLocaleDateString('en-IN'));

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(11).text('Customer Details');
    doc.font('Helvetica').fontSize(10).text(invoice.customer?.name ?? '—');
    if (invoice.customer?.email) doc.text(invoice.customer.email);
    if (invoice.customer?.phone) doc.text(invoice.customer.phone);

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(11).text('Service Details');
    doc.font('Helvetica').fontSize(10);
    if (invoice.booking?.service?.name) {
      doc.font('Helvetica-Bold').text('Service: ', { continued: true }).font('Helvetica').text(invoice.booking.service.name);
    }
    if (invoice.booking?.bookingRef || invoice.booking?.id) {
      doc.font('Helvetica-Bold').text('Booking ID: ', { continued: true }).font('Helvetica').text(invoice.booking.bookingRef ?? invoice.booking.id);
    }
    if (invoice.booking?.scheduledAt) {
      doc.font('Helvetica-Bold').text('Service Date: ', { continued: true }).font('Helvetica').text(new Date(invoice.booking.scheduledAt).toLocaleDateString('en-IN'));
    }
    if (invoice.booking?.timeSlot) {
      doc.font('Helvetica-Bold').text('Time Slot: ', { continued: true }).font('Helvetica').text(`${invoice.booking.timeSlot.startTime} - ${invoice.booking.timeSlot.endTime}`);
    }

    doc.moveDown(1.5);
    const tableTop = doc.y;
    const colX = { desc: 40, qty: 300, price: 360, amount: 450 };
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Description', colX.desc, tableTop);
    doc.text('Qty', colX.qty, tableTop);
    doc.text('Unit Price', colX.price, tableTop);
    doc.text('Amount', colX.amount, tableTop);
    doc.moveTo(40, tableTop + 16).lineTo(555, tableTop + 16).stroke();

    let y = tableTop + 24;
    doc.font('Helvetica').fontSize(10);
    for (const item of invoice.items) {
      doc.text(item.description, colX.desc, y, { width: 250 });
      doc.text(String(item.quantity), colX.qty, y);
      doc.text(`Rs. ${item.unitPrice.toFixed(2)}`, colX.price, y);
      doc.text(`Rs. ${item.amount.toFixed(2)}`, colX.amount, y);
      y += 20;
    }

    y += 10;
    doc.moveTo(340, y).lineTo(555, y).stroke();
    y += 10;
    const totalsRow = (label: string, value: number) => {
      doc.font('Helvetica').text(label, 340, y);
      doc.text(`Rs. ${value.toFixed(2)}`, colX.amount, y);
      y += 18;
    };
    totalsRow('Subtotal', invoice.subtotal);
    if (invoice.discountAmount) totalsRow('Discount', -invoice.discountAmount);
    if (invoice.isInterState) {
      totalsRow('IGST', invoice.igst);
    } else {
      totalsRow('CGST', invoice.cgst);
      totalsRow('SGST', invoice.sgst);
    }
    doc.font('Helvetica-Bold').fontSize(12).text('Total', 340, y);
    doc.text(`Rs. ${invoice.total.toFixed(2)}`, colX.amount, y);

    // Booking payment breakdown — the invoice's own `total` above is only the advance portion
    // for an ADVANCE-type invoice (see ensureAdvanceInvoice), so this section is what actually
    // represents the booking's real payment state: Total/Advance/Paid/Remaining, never
    // advanceAmount mistaken for paidAmount. Same derivation as the booking summary API
    // (BookingsService.getSummary) — see computeBookingPaymentSummary.
    y += 40;
    doc.moveTo(40, y).lineTo(555, y).stroke();
    y += 14;
    doc.font('Helvetica-Bold').fontSize(11).text('PAYMENT SUMMARY', 40, y);
    y += 18;
    const row = (label: string, value: string) => {
      doc.font('Helvetica-Bold').fontSize(10).text(label, 40, y, { continued: true });
      doc.font('Helvetica').text(`  ${value}`);
      y = doc.y + 4;
    };
    row('Total Amount:', `Rs. ${paymentSummary.totalAmount.toFixed(2)}`);
    if (paymentSummary.advanceAmount != null) {
      row('Advance Amount:', `Rs. ${paymentSummary.advanceAmount.toFixed(2)}`);
    }
    row('Paid Amount:', `Rs. ${paymentSummary.paidAmount.toFixed(2)}`);
    row('Remaining Amount:', `Rs. ${paymentSummary.remainingAmount.toFixed(2)}`);
    row('Payment Status:', paymentSummary.paymentStatus);

    y += 10;
    doc.moveTo(40, y).lineTo(555, y).stroke();
    y += 14;
    doc.font('Helvetica-Bold').fontSize(11).text('PAYMENT DETAILS', 40, y);
    y += 18;
    if (paymentSummary.method) row('Payment Method:', paymentSummary.method);
    if (paymentSummary.paidAt) row('Payment Date:', new Date(paymentSummary.paidAt).toLocaleDateString('en-IN'));
    if (paymentSummary.transactionId) row('Transaction ID:', paymentSummary.transactionId);
    if (!paymentSummary.method && !paymentSummary.paidAt && !paymentSummary.transactionId) {
      doc.font('Helvetica').fontSize(10).text('No payment recorded yet.', 40, y);
    }

    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.end();
    return done;
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
