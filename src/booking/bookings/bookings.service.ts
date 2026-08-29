import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, ActivityModule, AttendanceStatus, AuditAction, Booking, BookingStatus, LeaveRequestStatus, NotificationType, PaymentMethod, PaymentStatus, PaymentType, Prisma, Role, TaskPhotoType } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { ActivityLogService } from '../../activity-log/activity-log.service';
import { DEFAULTS, SETTING_KEYS } from '../../admin/admin.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { getTodayRange } from '../../common/utils/date.util';
import { EmailService } from '../../email/email.service';
import { InvoicesService } from '../../invoicing/invoices/invoices.service';
import { PaymentsService } from '../../invoicing/payments/payments.service';
import { VerifyRazorpayDto } from '../../invoicing/payments/dto/verify-razorpay.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AddBookingPhotoDto } from './dto/add-booking-photo.dto';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { AssignWorkerDto } from './dto/assign-worker.dto';
import { BookingQueryDto } from './dto/booking-query.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CollectPaymentDto } from './dto/collect-payment.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { PreviewBookingPriceDto } from './dto/preview-booking-price.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';
import { StartBookingDto } from './dto/start-booking.dto';
import { VerifyBookingPaymentDto } from './dto/verify-booking-payment.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

// ─── Select shapes ─────────────────────────────────────────────────────────────

const BOOKING_USER_SELECT = {
  id: true, name: true, email: true, phone: true, role: true, profileImage: true,
} satisfies Prisma.UserSelect;

const BOOKING_INCLUDE = {
  service:                  { select: { id: true, name: true, thumbnail: true } },
  propertyType:             { select: { id: true, name: true } },
  package:      { select: { id: true, name: true, price: true, durationMinutes: true } },
  pricingOption: { select: { id: true, label: true, price: true } },
  timeSlot:     { select: { id: true, date: true, startTime: true, endTime: true } },
  address:      true,
  customer:     { select: BOOKING_USER_SELECT },
  worker:       { select: BOOKING_USER_SELECT },
  manager:      { select: BOOKING_USER_SELECT },
  createdBy:    { select: BOOKING_USER_SELECT },
  photos:       { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.BookingInclude;

// Payment method as the Worker Panel UI knows it ('qr' | 'cash') — the app only ever
// collects one of these two in person, mapped onto the broader PaymentMethod enum used
// everywhere else (UPI / CASH respectively) so no new enum is introduced.
const PAYMENT_METHOD_TO_UI: Partial<Record<PaymentMethod, 'qr' | 'cash'>> = {
  [PaymentMethod.UPI]: 'qr',
  [PaymentMethod.CASH]: 'cash',
};
const PAYMENT_METHOD_FROM_UI: Record<'qr' | 'cash', PaymentMethod> = {
  qr: PaymentMethod.UPI,
  cash: PaymentMethod.CASH,
};

// Worker-facing booking status ('assigned' → 'accepted' once workerAcceptedAt is set) —
// distinct from the admin/manager-facing BookingStatus enum above, which is unchanged.
type WorkerJobStatus = 'assigned' | 'accepted' | 'in-progress' | 'completed' | 'cancelled';

function toWorkerJobStatus(booking: { status: BookingStatus; workerAcceptedAt: Date | null }): WorkerJobStatus {
  switch (booking.status) {
    case BookingStatus.ASSIGNED:
      return booking.workerAcceptedAt ? 'accepted' : 'assigned';
    case BookingStatus.IN_PROGRESS:
      return 'in-progress';
    case BookingStatus.COMPLETED:
      return 'completed';
    default:
      return 'cancelled';
  }
}

const BOOKING_DETAIL_INCLUDE = {
  ...BOOKING_INCLUDE,
  statusHistory: {
    select: {
      id: true, status: true, note: true, createdAt: true,
      actor: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.BookingInclude;

// ─── Status machine ────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.PENDING_PAYMENT]: [BookingStatus.PENDING, BookingStatus.CANCELLED],
  // RESCHEDULED is reachable from PENDING too — the controller has always documented reschedule
  // as "PENDING / CONFIRMED -> RESCHEDULED", but this map only listed CONFIRMED, so any booking
  // still awaiting manager confirmation got a hard "Cannot transition booking from PENDING to
  // RESCHEDULED" 400 on every reschedule attempt. Root cause of "reschedule not working".
  [BookingStatus.PENDING]:     [BookingStatus.CONFIRMED, BookingStatus.CANCELLED, BookingStatus.RESCHEDULED],
  [BookingStatus.CONFIRMED]:   [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED, BookingStatus.RESCHEDULED, BookingStatus.NO_SHOW],
  [BookingStatus.ASSIGNED]:    [BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.IN_PROGRESS]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.RESCHEDULED]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
};

const TERMINAL_STATUSES: BookingStatus[] = [
  BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.NO_SHOW,
];

// Statuses that actually hold a TimeSlot's capacity. PENDING_PAYMENT never appears here —
// a booking in that status hasn't paid yet and must never block the slot for anyone else.
// PENDING is included even though the task's requested list only named
// CONFIRMED/ASSIGNED/IN_PROGRESS: PENDING means "Razorpay payment already verified as
// successful, awaiting manager confirmation" (see verifyPaymentAndConfirm below) — excluding
// it would let two different customers both pay for the same slot before a manager gets to
// confirm either one, which is a worse double-booking bug than the one being fixed here.
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS,
];

const r2 = (n: number) => parseFloat(n.toFixed(2));

// Booking/payment amounts (totalAmount, advanceAmount, remainingAmount, and the amount
// actually charged via Razorpay) are stored and charged in whole rupees, not paise-precision
// decimals — r2 stays 2-decimal for GST-line-item math elsewhere, this is only for the
// customer-facing booking amount fields.
const r0 = (n: number) => Math.round(n);

// Masks an email for logging — keeps the first character and the domain, e.g.
// "tiger84300@gmail.com" -> "t*******0@gmail.com". Never log a full recipient address.
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 2) return `${local?.[0] ?? '*'}***@${domain ?? 'unknown'}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
}

// ─── Worker job response shaping ───────────────────────────────────────────────
// Maps a Booking (BOOKING_INCLUDE shape) onto the flat "job" contract the Worker Panel
// screens (Jobs / Job Details / Start Work / Before-After Image / Payment / Complete Task)
// bind to — a single source of truth reused by every worker-facing booking read below.

type WorkerJobBooking = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

function formatSlotTime(timeSlot: WorkerJobBooking['timeSlot']): string {
  if (!timeSlot) return '';
  const fmt = (t: string) => {
    const [hStr, m] = t.split(':');
    const h = parseInt(hStr, 10);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === '00' ? `${h12} ${period}` : `${h12}:${m} ${period}`;
  };
  return `${fmt(timeSlot.startTime)} - ${fmt(timeSlot.endTime)}`;
}

function toWorkerJobDto(booking: WorkerJobBooking) {
  const beforePhoto = booking.photos.find((p) => p.type === TaskPhotoType.BEFORE) ?? null;
  const afterPhoto = booking.photos.find((p) => p.type === TaskPhotoType.AFTER) ?? null;

  return {
    id: booking.id,
    status: toWorkerJobStatus(booking),
    serviceType: booking.service.name,
    customerName: booking.customer.name,
    customerPhone: booking.customer.phone,
    address: booking.address?.street ?? '',
    city: booking.address?.city ?? '',
    pincode: booking.address?.pincode ?? '',
    lat: booking.address?.latitude ?? null,
    lng: booking.address?.longitude ?? null,
    scheduledDate: booking.scheduledAt.toISOString().split('T')[0],
    scheduledTime: formatSlotTime(booking.timeSlot),
    amount: booking.totalAmount ?? 0,
    advancePaid: booking.advanceAmount ?? 0,
    description: `${booking.package.name} — ${booking.propertyType.name}`,
    notes: booking.notes ?? '',
    startLocation:
      booking.workerStartLatitude != null && booking.workerStartLongitude != null
        ? { lat: booking.workerStartLatitude, lng: booking.workerStartLongitude }
        : null,
    startTimestamp: booking.workerStartAt?.toISOString() ?? null,
    beforeImage: beforePhoto
      ? {
          uri: beforePhoto.imageUrl,
          timestamp: beforePhoto.createdAt.toISOString(),
          coords: beforePhoto.latitude != null && beforePhoto.longitude != null
            ? { lat: beforePhoto.latitude, lng: beforePhoto.longitude }
            : null,
        }
      : null,
    afterImage: afterPhoto
      ? {
          uri: afterPhoto.imageUrl,
          timestamp: afterPhoto.createdAt.toISOString(),
          coords: afterPhoto.latitude != null && afterPhoto.longitude != null
            ? { lat: afterPhoto.latitude, lng: afterPhoto.longitude }
            : null,
        }
      : null,
    paymentMethod: booking.paymentCollectionMethod
      ? (PAYMENT_METHOD_TO_UI[booking.paymentCollectionMethod] ?? 'cash')
      : null,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  // TEMPORARY diagnostic wrapper for createBooking() — logs the query label before running
  // it and the Prisma error code/meta/message if it throws. Remove once the 500 investigation
  // on POST /bookings is closed out.
  private async runQuery<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.logger.log(`[createBooking] running query: ${label}`);
    try {
      return await fn();
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        this.logger.error(
          `[createBooking] FAILED query: ${label} | prismaCode=${error.code} | meta=${JSON.stringify(error.meta)} | message=${error.message}`,
        );
      } else {
        this.logger.error(`[createBooking] FAILED query: ${label} | ${(error as Error).message}`, (error as Error).stack);
      }
      throw error;
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
    private readonly activityLog: ActivityLogService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Create ───────────────────────────────────────────────────────────────────

  async create(dto: CreateBookingDto, customerId: string, orgId?: string) {
    const service = await this.runQuery('service lookup (service.findUnique)', () =>
      this.prisma.service.findUnique({
        where: { id: dto.serviceId },
        select: { id: true, name: true, isActive: true },
      }),
    );
    if (!service) throw new NotFoundException('Service not found');
    if (!service.isActive) throw new BadRequestException('Service is not available for booking');

    const propertyType = await this.runQuery('property type lookup (propertyType.findUnique)', () =>
      this.prisma.propertyType.findUnique({
        where: { id: dto.propertyTypeId },
        select: { id: true, serviceId: true, isActive: true },
      }),
    );
    if (!propertyType || propertyType.serviceId !== dto.serviceId) {
      throw new BadRequestException('Property type does not belong to the selected service');
    }
    if (!propertyType.isActive) throw new BadRequestException('Property type is not available for booking');

    const pkg = await this.runQuery('package lookup (package.findUnique)', () =>
      this.prisma.package.findUnique({
        where: { id: dto.packageId },
        select: { id: true, propertyTypeId: true, price: true, isActive: true },
      }),
    );
    if (!pkg || pkg.propertyTypeId !== dto.propertyTypeId) {
      throw new BadRequestException('Package does not belong to the selected property type');
    }
    if (!pkg.isActive) throw new BadRequestException('Package is not available for booking');

    const pricingOption = await this.runQuery('pricing option lookup (pricingOption.findUnique)', () =>
      this.prisma.pricingOption.findUnique({
        where: { id: dto.pricingOptionId },
        select: { id: true, packageId: true, isActive: true, price: true },
      }),
    );
    if (!pricingOption || pricingOption.packageId !== dto.packageId) {
      throw new BadRequestException('Pricing option does not belong to the selected package');
    }
    if (!pricingOption.isActive) {
      throw new BadRequestException('Pricing option is not available for booking');
    }

    const scheduledAt = new Date(dto.bookingDate);
    if (scheduledAt < new Date()) throw new BadRequestException('Booking date must be in the future');

    await this.runQuery('time slot lookup + capacity check (validateAndClaimSlot)', () =>
      this.validateAndClaimSlot(dto.timeSlotId, dto.serviceId),
    );

    const address = await this.runQuery('address lookup (address.findUnique)', () =>
      this.prisma.address.findUnique({ where: { id: dto.addressId } }),
    );
    if (!address || address.userId !== customerId) {
      throw new BadRequestException('Invalid address');
    }

    await this.runQuery('service area + area-service availability check', async () => {
      const area = await this.prisma.area.findFirst({
        where: { pincode: address.pincode, isActive: true },
        select: { id: true },
      });
      if (!area) {
        throw new BadRequestException('Ziclo isn\'t available in this area yet.');
      }
      const areaService = await this.prisma.areaService.findUnique({
        where: { areaId_serviceId: { areaId: area.id, serviceId: dto.serviceId } },
        select: { isActive: true },
      });
      if (areaService && !areaService.isActive) {
        throw new BadRequestException('This service is not available in your area');
      }
    });

    const bookingRef = await this.runQuery('booking ref generation (booking.count)', () => this.generateRef());
    // Same GST-inclusive total previewPrice() shows the customer before they book (servicePrice
    // + tax, rounded to the nearest rupee) — booking.totalAmount must match what was previewed,
    // otherwise the amount charged later drifts from what the customer was quoted.
    const { taxPercentage, advancePaymentPercentage } = await this.getOrgPaymentSettings();
    const servicePrice = pricingOption.price;
    const gst = r2((servicePrice * taxPercentage) / 100);
    const totalAmount = r0(servicePrice + gst);
    // Root cause of "advance payment charges the full amount": this used to be
    // `advanceAmount: totalAmount` — i.e. the "advance" was always the full total,
    // so the Razorpay order created later off booking.advanceAmount was never actually
    // reduced for ADVANCE payments. Compute it from the org's configured percentage instead.
    const advanceAmount = r0((totalAmount * advancePaymentPercentage) / 100);

    const booking = await this.runQuery('create booking (booking.create)', () =>
      this.prisma.booking.create({
        data: {
          serviceId:      dto.serviceId,
          propertyTypeId: dto.propertyTypeId,
          packageId:      dto.packageId,
          pricingOptionId: dto.pricingOptionId,
          timeSlotId:     dto.timeSlotId,
          customerId,
          scheduledAt,
          notes:          dto.notes,
          createdById:    customerId,
          organizationId: orgId ?? null,
          addressId:      dto.addressId,
          totalAmount,
          advanceAmount,
          packagePrice:   pkg.price,
          bookingRef,
          status:         BookingStatus.PENDING_PAYMENT,
          paymentStatus:  PaymentStatus.CREATED,
        },
        include: BOOKING_INCLUDE,
      }),
    );

    await this.runQuery('booking status history insert (bookingStatusHistory.create)', () =>
      this.recordStatusHistory(booking.id, BookingStatus.PENDING_PAYMENT, customerId, 'Booking created — awaiting payment'),
    );

    this.logger.debug(
      `[create] Booking Status: ${booking.status} | Slot Capacity: n/a | Active Booking Count: n/a | ` +
        `Remaining Capacity: n/a | Reservation Triggered: false (PENDING_PAYMENT bookings never consume slot capacity)`,
    );

    this.auditLogs
      .log({ actorId: customerId, entityType: 'Booking', entityId: booking.id, action: AuditAction.CREATE, newValue: { serviceId: dto.serviceId, scheduledAt } })
      .catch(() => {});
    this.activityLog.log({
      action: ActivityAction.BOOKING_CREATED,
      module: ActivityModule.BOOKING,
      description: `${booking.customer.name} booked ${booking.service.name}`,
      actor: { id: customerId, name: booking.customer.name, role: booking.customer.role },
      target: { id: booking.id, type: 'Booking' },
      organizationId: orgId,
      metadata: { bookingRef, amount: booking.totalAmount, scheduledAt: booking.scheduledAt },
    });

    // Fire-and-forget — never block booking creation on notification delivery.
    this.notifyAreaManagers(booking, address.pincode).catch(() => {});

    return { success: true, message: 'Booking created successfully', data: booking };
  }

  // Finds managers whose assigned Area covers the customer's address pincode and notifies
  // each of them that a new booking landed in their area. Reuses NotificationsService.notify
  // (persists an unread Notification row + dispatches an FCM push when configured) — no new
  // notification delivery mechanism is introduced.
  private async notifyAreaManagers(
    booking: { id: string; bookingRef: string | null; service: { name: string } },
    pincode: string,
  ): Promise<void> {
    const area = await this.prisma.area.findFirst({ where: { pincode, isActive: true }, select: { id: true } });
    if (!area) return;

    const managerAreas = await this.prisma.managerArea.findMany({
      where: { areaId: area.id },
      select: { manager: { select: { userId: true } } },
    });

    await Promise.all(
      managerAreas.map((ma) =>
        this.notifications
          .notify(
            ma.manager.userId,
            'New Booking in Your Area',
            `A new booking (${booking.bookingRef ?? booking.id}) for ${booking.service.name} was created in your assigned area.`,
            { bookingId: booking.id },
            NotificationType.BOOKING_CREATED,
          )
          .catch(() => {}),
      ),
    );
  }

  // ─── Read ─────────────────────────────────────────────────────────────────────

  async findAll(query: BookingQueryDto, orgId?: string) {
    const { page = 1, limit = 20, status, customerId, workerId, managerId, serviceId, scheduledFrom, scheduledTo } = query;
    const skip = (page - 1) * limit;
    const where = this.buildWhere({ status, customerId, workerId, managerId, serviceId, scheduledFrom, scheduledTo });

    if (orgId) where.organizationId = orgId;

    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include: BOOKING_INCLUDE, skip, take: limit, orderBy: { scheduledAt: 'asc' } }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      success: true,
      data: { bookings, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: BOOKING_DETAIL_INCLUDE });
    if (!booking) throw new NotFoundException('Booking not found');
    return { success: true, data: booking };
  }

  async getSummary(id: string, actor?: { id: string; role: Role }) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        service:      { select: { id: true, name: true, thumbnail: true } },
        propertyType: { select: { id: true, name: true } },
        package:      { select: { id: true, name: true, description: true, price: true, durationMinutes: true } },
        pricingOption: { select: { id: true, label: true, price: true } },
        timeSlot:     { select: { id: true, date: true, startTime: true, endTime: true } },
        address:      true,
        customer:     { select: { id: true, name: true, email: true, phone: true } },
        // Same source of truth getPaymentConfig() already uses for "amount actually paid":
        // only SUCCESS payments, summed. For a partial (ADVANCE) payment this correctly
        // reflects what was actually collected, not booking.advanceAmount (the amount that
        // was merely due).
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            pdfUrl: true,
            pdfGeneratedAt: true,
            payments: {
              where: { status: PaymentStatus.SUCCESS },
              select: {
                amount: true,
                method: true,
                paidAt: true,
                transactions: { select: { razorpayPaymentId: true }, orderBy: { createdAt: 'desc' }, take: 1 },
              },
              orderBy: { paidAt: 'desc' },
            },
          },
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    // USER can only view their own booking's summary — ADMIN/MANAGER/WORKER (the endpoint's
    // other allowed roles) keep unrestricted access, matching every other USER-facing booking
    // read in this service (see assertOwner call sites elsewhere).
    if (actor?.role === Role.USER) this.assertOwner(booking, actor.id);

    const totalAmount = r0(booking.totalAmount ?? 0);
    // Sum of actually-SUCCESS payments on this booking's invoice is the authoritative "amount
    // paid online" — same source assertPayableInvoice() already treats as ground truth when
    // computing outstanding balance for a new Razorpay order. booking.paidAmount is only a
    // fallback for the rare case a booking has no invoice at all (e.g. legacy data) — it must
    // never take priority over the real payment ledger, and it must never be skipped just
    // because the online-paid sum is legitimately 0 (an invoice with no successful payments yet
    // really has paid 0, so this is an invoice-exists check, not a truthiness check on the sum).
    const onlinePaid = r0(
      booking.invoice
        ? r2(booking.invoice.payments.reduce((sum, p) => sum + p.amount, 0))
        : (booking.paidAmount ?? 0),
    );
    // Booking.paymentCollectedAt is set by the WORKER's in-person "Payment" step
    // (collectPayment, Worker Panel: Payment step) once the outstanding job-time balance
    // (cash/UPI QR) has been collected. That step only ever records a method, not a partial
    // amount — there is no supported flow for paying a booking's remaining balance online after
    // its advance (ensureAdvanceInvoice() explicitly rejects switching an invoice's payment type
    // once it already has a successful payment). So for any booking where the worker has
    // confirmed in-person collection, the true paidAmount is the full totalAmount — reading an
    // already-recorded real event, not fabricating a number.
    const paidAmount = booking.paymentCollectedAt ? totalAmount : onlinePaid;
    const remainingAmount = Math.max(0, totalAmount - paidAmount);
    const latestPayment = booking.invoice?.payments[0];
    // Same derived bucket InvoicesService.computeBookingPaymentSummary computes from the exact
    // same numbers — the two live in different modules (can't share via DI, see that method's
    // comment) so this is the identical formula re-applied here, not a second calculation.
    // Invoice and Booking Summary must never disagree on this.
    const paymentStatus =
      totalAmount > 0 && paidAmount >= totalAmount ? 'PAID' : paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

    return {
      success: true,
      data: {
        bookingRef: booking.bookingRef,
        status: booking.status,
        service: booking.service,
        scheduledAt: booking.scheduledAt,
        timeSlot: booking.timeSlot,
        customer: booking.customer,
        address: booking.address,
        propertyType: booking.propertyType,
        package: booking.package
          ? { ...booking.package, price: booking.packagePrice ?? booking.package.price }
          : null,
        pricingOption: booking.pricingOption,
        pricing: {
          totalAmount,
          advanceAmount: booking.advanceAmount,
          paidAmount,
          remainingAmount,
        },
        payment: {
          status: booking.paymentStatus,
          paymentStatus,
          method: latestPayment?.method ?? booking.paymentMethod ?? null,
          paidAt: latestPayment?.paidAt ?? booking.paidAt ?? null,
          transactionId: latestPayment?.transactions[0]?.razorpayPaymentId ?? booking.razorpayPaymentId ?? null,
          // The in-person (cash/QR) leg, if any — kept separate from the online status/method/
          // transactionId above rather than overwritten into them, since a cash collection has
          // no transaction id and reusing those fields for it would misrepresent it as an online
          // payment. These are the same Booking columns collectPayment() already writes.
          paymentCollectionMethod: booking.paymentCollectionMethod,
          paymentCollectedAt: booking.paymentCollectedAt,
        },
        invoice: booking.invoice
          ? {
              id: booking.invoice.id,
              invoiceNumber: booking.invoice.invoiceNumber,
              status: booking.invoice.status,
              total: booking.invoice.total,
              pdfUrl: booking.invoice.pdfUrl,
              pdfGeneratedAt: booking.invoice.pdfGeneratedAt,
            }
          : null,
        notes: booking.notes,
      },
    };
  }

  // Customer-facing: home "Recent Activity", "Booking History", and "Upcoming Bookings" all
  // read from this one method. A booking sits in PENDING_PAYMENT (awaiting Razorpay
  // verification) from the moment it's created — until verifyBookingPayment confirms it, it
  // must stay invisible here so a failed/abandoned payment never shows the customer a
  // "booking" that isn't real. Callers can still explicitly filter `status: PENDING_PAYMENT`
  // (e.g. a future "payment pending" tab).
  async getMyBookings(customerId: string, query: BookingQueryDto) {
    const { page = 1, limit = 20, status, serviceId, scheduledFrom, scheduledTo } = query;
    const skip = (page - 1) * limit;
    const where = this.buildWhere({ customerId, status, serviceId, scheduledFrom, scheduledTo });
    if (!status) where.status = { not: BookingStatus.PENDING_PAYMENT };

    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include: BOOKING_INCLUDE, skip, take: limit, orderBy: { scheduledAt: 'desc' } }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      success: true,
      data: { bookings, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  // Root cause of "a new service request for a pincode the manager is assigned to never shows
  // up in Manager Jobs": this is the actual endpoint the Manager Jobs screen calls (GET
  // bookings/manager/me — see BookingsController), and buildWhere's managerId filter is an
  // exact-match-only `Booking.managerId = X`. A brand-new request starts with managerId null
  // (nobody has explicitly assigned it yet), so it was structurally invisible here regardless
  // of pincode, even though a near-identical fix already exists for the separate `managers/jobs`
  // endpoint (ManagerService.resolveManagerBookingScope). Adding the same
  // Address.pincode-in-manager's-territory branch here closes the actual gap the frontend hits.
  async getManagerBookings(managerId: string, query: BookingQueryDto) {
    const { page = 1, limit = 20, status, serviceId, scheduledFrom, scheduledTo } = query;
    const skip = (page - 1) * limit;
    const baseWhere = this.buildWhere({ status, serviceId, scheduledFrom, scheduledTo });
    const pincodes = await this.resolveManagerPincodes(managerId);

    const where: Prisma.BookingWhereInput = {
      AND: [
        baseWhere,
        {
          OR: [
            { managerId },
            ...(pincodes.length > 0 ? [{ address: { pincode: { in: pincodes } } }] : []),
          ],
        },
      ],
    };

    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include: BOOKING_INCLUDE, skip, take: limit, orderBy: { scheduledAt: 'asc' } }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      success: true,
      data: { bookings, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  // Same manager -> assigned Area/Pincode -> pincode-string resolution as
  // ManagerService.resolveManagerPincodes (same underlying ManagerPincode/ManagerArea/Area/
  // Pincode tables — not a second area/pincode mapping system, just queried from this module
  // too since BookingsModule can't import ManagerModule here — ManagerModule already imports
  // BookingsModule, and Nest doesn't allow the reverse). Only active Pincode/Area rows count,
  // same "isActive" gate booking creation itself already enforces (see AreasService).
  private async resolveManagerPincodes(managerUserId: string): Promise<string[]> {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerUserId },
      select: {
        pincodes: { where: { pincode: { isActive: true } }, select: { pincode: { select: { pincode: true } } } },
        areas: { where: { area: { isActive: true } }, select: { area: { select: { pincode: true } } } },
      },
    });
    if (!profile) return [];
    if (profile.pincodes.length > 0) return profile.pincodes.map((p) => p.pincode.pincode);
    return profile.areas.map((a) => a.area.pincode);
  }

  // Worker Panel "Jobs" screen — response shaped via toWorkerJobDto (see above) to match
  // the UI's flat job contract directly, rather than the nested admin/manager booking shape.
  async getWorkerBookings(workerId: string, query: BookingQueryDto) {
    const { page = 1, limit = 20, status, serviceId, scheduledFrom, scheduledTo } = query;
    const skip = (page - 1) * limit;
    const where = this.buildWhere({ workerId, status, serviceId, scheduledFrom, scheduledTo });

    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include: BOOKING_INCLUDE, skip, take: limit, orderBy: { scheduledAt: 'asc' } }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      success: true,
      data: {
        jobs: bookings.map(toWorkerJobDto),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  // Worker Panel "Job Details" screen — single job, ownership-checked.
  async getWorkerJobById(id: string, workerId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: BOOKING_INCLUDE });
    if (!booking) throw new NotFoundException('Job not found');
    if (booking.workerId !== workerId) throw new ForbiddenException('This job is not assigned to you');
    return { success: true, data: toWorkerJobDto(booking) };
  }

  // Worker Panel "Start Work" (accept step) — ASSIGNED, not yet accepted → accepted.
  async acceptByWorker(id: string, workerId: string) {
    const booking = await this.requireBookingWithService(id);
    if (booking.workerId !== workerId) throw new ForbiddenException('This job is not assigned to you');
    if (booking.status !== BookingStatus.ASSIGNED) {
      throw new BadRequestException('Only an assigned job can be accepted');
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { workerAcceptedAt: new Date() },
      include: BOOKING_INCLUDE,
    });

    this.audit(workerId, id, AuditAction.UPDATE, { workerAcceptedAt: updated.workerAcceptedAt });

    this.notifications.notify(booking.customerId, 'Worker Accepted Your Booking', `Your worker for ${booking.service.name} has accepted the job.`, { bookingId: id }, NotificationType.WORKER_ACCEPTED).catch(() => {});
    if (booking.managerId) {
      this.notifications.notify(booking.managerId, 'Worker Accepted Job', `The worker assigned to booking ${booking.bookingRef ?? id} has accepted it.`, { bookingId: id }, NotificationType.WORKER_ACCEPTED).catch(() => {});
    }

    return { success: true, message: 'Job accepted', data: toWorkerJobDto(updated) };
  }

  // Worker Panel "Before Photo" / "After Photo" steps.
  async addPhoto(id: string, workerId: string, dto: AddBookingPhotoDto) {
    const booking = await this.requireBooking(id);
    if (booking.workerId !== workerId) throw new ForbiddenException('This job is not assigned to you');

    await this.prisma.bookingPhoto.create({
      data: {
        bookingId: id,
        imageUrl: dto.imageUrl,
        type: dto.type,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });

    const updated = await this.prisma.booking.findUniqueOrThrow({ where: { id }, include: BOOKING_INCLUDE });
    return { success: true, message: 'Photo saved', data: toWorkerJobDto(updated) };
  }

  // Worker Panel "Payment" step.
  async collectPayment(id: string, workerId: string, dto: CollectPaymentDto) {
    const booking = await this.requireBooking(id);
    if (booking.workerId !== workerId) throw new ForbiddenException('This job is not assigned to you');

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        paymentCollectionMethod: PAYMENT_METHOD_FROM_UI[dto.method],
        paymentCollectedAt: new Date(),
      },
      include: BOOKING_INCLUDE,
    });

    this.audit(workerId, id, AuditAction.UPDATE, { paymentCollectionMethod: updated.paymentCollectionMethod });

    return { success: true, message: 'Payment recorded', data: toWorkerJobDto(updated) };
  }

  async getCustomerHistory(customerId: string, query: BookingQueryDto) {
    const { page = 1, limit = 20, status, serviceId, scheduledFrom, scheduledTo } = query;
    const skip = (page - 1) * limit;
    const where = this.buildWhere({ customerId, status, serviceId, scheduledFrom, scheduledTo });

    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, include: BOOKING_INCLUDE, skip, take: limit, orderBy: { scheduledAt: 'desc' } }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      success: true,
      data: { bookings, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  // ─── Update ───────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateBookingDto, actorId: string) {
    const booking = await this.requireBooking(id);
    this.assertNotTerminal(booking.status);

    if (dto.scheduledAt && booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('scheduledAt can only be changed while booking is PENDING');
    }
    if (dto.scheduledAt && dto.scheduledAt < new Date()) {
      throw new BadRequestException('Scheduled date must be in the future');
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        ...(dto.notes       !== undefined && { notes:       dto.notes }),
        ...(dto.scheduledAt !== undefined && { scheduledAt: dto.scheduledAt }),
      },
      include: BOOKING_INCLUDE,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Booking', entityId: id, action: AuditAction.UPDATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Booking updated', data: updated };
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  async remove(id: string, actorId: string) {
    const booking = await this.requireBooking(id);
    if (!TERMINAL_STATUSES.includes(booking.status)) {
      throw new BadRequestException('Only completed, cancelled, or no-show bookings can be deleted');
    }
    await this.prisma.booking.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'Booking', entityId: id, action: AuditAction.DELETE, oldValue: { status: booking.status } })
      .catch(() => {});

    return { success: true, message: 'Booking deleted successfully' };
  }

  // ─── Assign Manager → CONFIRMED ───────────────────────────────────────────────

  async assignManager(id: string, actorId: string, dto: AssignManagerDto) {
    const booking = await this.requireBookingWithService(id);
    this.assertNotTerminal(booking.status);

    const manager = await this.prisma.user.findUnique({
      where: { id: dto.managerId },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!manager || (manager.role !== Role.MANAGER && manager.role !== Role.ADMIN)) {
      throw new BadRequestException('Assigned user is not a valid manager');
    }
    if (!manager.isActive) throw new BadRequestException('Manager account is inactive');

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { managerId: dto.managerId, status: BookingStatus.CONFIRMED },
      include: BOOKING_INCLUDE,
    });

    await this.recordStatusHistory(id, BookingStatus.CONFIRMED, actorId, `Assigned to manager: ${manager.name}`);
    this.audit(actorId, id, AuditAction.ASSIGN, { managerId: dto.managerId, status: BookingStatus.CONFIRMED });

    this.notifications.notify(dto.managerId, 'Booking Assigned to You', `Booking for ${booking.service.name} on ${booking.scheduledAt.toISOString().slice(0, 10)} has been assigned to you.`, { bookingId: id }, NotificationType.MANAGER_ASSIGNED).catch(() => {});
    this.notifications.notify(booking.customerId, 'Booking Confirmed', `Your booking for ${booking.service.name} has been confirmed.`, { bookingId: id }, NotificationType.MANAGER_ASSIGNED).catch(() => {});

    return { success: true, message: 'Manager assigned and booking confirmed', data: updated };
  }

  // ─── Assign Worker → ASSIGNED ─────────────────────────────────────────────────

  async assignWorker(id: string, actorId: string, dto: AssignWorkerDto) {
    const booking = await this.requireBookingWithService(id);
    this.assertNotTerminal(booking.status);

    const worker = await this.prisma.user.findUnique({
      where: { id: dto.workerId },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!worker || worker.role !== Role.WORKER) throw new BadRequestException('Assigned user is not a valid worker');
    if (!worker.isActive) throw new BadRequestException('Worker account is inactive');

    // Re-checked at the exact moment of assignment (not earlier, e.g. when the manager's
    // assignment screen was opened) — a worker who checks out between screen-open and the
    // manager pressing "Assign" must still be blocked here.
    await this.assertWorkerOnDuty(dto.workerId);

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { workerId: dto.workerId, status: BookingStatus.ASSIGNED },
      include: BOOKING_INCLUDE,
    });

    await this.recordStatusHistory(id, BookingStatus.ASSIGNED, actorId, `Assigned to worker: ${worker.name}`);
    this.audit(actorId, id, AuditAction.ASSIGN, { workerId: dto.workerId, status: BookingStatus.ASSIGNED });
    this.activityLog.log({
      action: ActivityAction.WORKER_ASSIGNED,
      module: ActivityModule.BOOKING,
      description: `${worker.name} assigned to booking ${booking.bookingRef ?? id}`,
      actor: { id: actorId, name: 'Manager', role: Role.MANAGER },
      target: { id: booking.id, type: 'Booking' },
      metadata: { bookingRef: booking.bookingRef, workerName: worker.name, workerId: dto.workerId },
    });

    this.notifications.notify(dto.workerId, 'Booking Assigned to You', `You have been assigned to ${booking.service.name} on ${booking.scheduledAt.toISOString().slice(0, 10)}.`, { bookingId: id }, NotificationType.WORKER_ASSIGNED).catch(() => {});
    this.notifications.notify(booking.customerId, 'Worker Assigned', `A worker has been assigned to your booking for ${booking.service.name}.`, { bookingId: id }, NotificationType.WORKER_ASSIGNED).catch(() => {});

    return { success: true, message: 'Worker assigned and booking set to ASSIGNED', data: updated };
  }

  // ─── Confirm ──────────────────────────────────────────────────────────────────

  async confirm(id: string, managerId: string) {
    const booking = await this.requireBookingWithService(id);
    this.assertNotTerminal(booking.status);
    this.assertTransition(booking.status, BookingStatus.CONFIRMED);

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.CONFIRMED, managerId },
      include: BOOKING_INCLUDE,
    });

    await this.recordStatusHistory(id, BookingStatus.CONFIRMED, managerId);
    this.audit(managerId, id, AuditAction.STATUS_CHANGE, { status: BookingStatus.CONFIRMED });

    this.notifications.notify(booking.customerId, 'Booking Confirmed', `Your booking for ${booking.service.name} has been confirmed.`, { bookingId: id }).catch(() => {});

    return { success: true, message: 'Booking confirmed', data: updated };
  }

  // ─── Start ────────────────────────────────────────────────────────────────────

  async start(id: string, workerId: string, dto?: StartBookingDto) {
    const booking = await this.requireBookingWithService(id);
    if (booking.workerId !== workerId) throw new ForbiddenException('This booking is not assigned to you');
    this.assertTransition(booking.status, BookingStatus.IN_PROGRESS);

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.IN_PROGRESS,
        workerStartAt: new Date(),
        workerStartLatitude: dto?.latitude,
        workerStartLongitude: dto?.longitude,
      },
      include: BOOKING_INCLUDE,
    });

    await this.recordStatusHistory(id, BookingStatus.IN_PROGRESS, workerId);
    this.audit(workerId, id, AuditAction.STATUS_CHANGE, { status: BookingStatus.IN_PROGRESS });

    this.notifications.notify(booking.customerId, 'Service Started', `Your booking for ${booking.service.name} is now in progress.`, { bookingId: id }, NotificationType.WORK_STARTED).catch(() => {});

    return { success: true, message: 'Booking started', data: toWorkerJobDto(updated) };
  }

  // ─── Complete ─────────────────────────────────────────────────────────────────

  async complete(id: string, actorId: string) {
    const booking = await this.requireBookingWithService(id);

    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (actor?.role === Role.WORKER && booking.workerId !== actorId) {
      throw new ForbiddenException('This booking is not assigned to you');
    }

    const completableStatuses: BookingStatus[] = [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS];
    if (!completableStatuses.includes(booking.status)) {
      throw new BadRequestException(`Cannot complete a booking in ${booking.status} state`);
    }

    // Service must not be completable while money is still owed — checkout being opened is
    // not payment; only a backend-verified Razorpay SUCCESS (or the worker's in-person cash/QR
    // collection) counts. Same remaining-amount derivation getSummary() uses (sum of this
    // booking's SUCCESS payments, or the full total if paymentCollectedAt is set) — never a
    // second calculation.
    const remaining = await this.getRemainingAmount(id);
    if (remaining > 0) {
      throw new BadRequestException(
        `Cannot complete booking: outstanding payment of Rs. ${remaining} has not been received. Collect the remaining payment before completing.`,
      );
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.COMPLETED, completedAt: new Date() },
      include: BOOKING_INCLUDE,
    });

    await this.recordStatusHistory(id, BookingStatus.COMPLETED, actorId);
    this.audit(actorId, id, AuditAction.STATUS_CHANGE, { status: BookingStatus.COMPLETED });
    this.activityLog.log({
      action: ActivityAction.BOOKING_COMPLETED,
      module: ActivityModule.BOOKING,
      description: `Booking ${booking.bookingRef ?? id} completed — ${booking.service.name}`,
      actor: { id: actorId, name: 'Staff', role: actor?.role ?? Role.WORKER },
      target: { id: booking.id, type: 'Booking' },
      metadata: { bookingRef: booking.bookingRef, serviceName: booking.service.name },
    });

    this.notifications.notify(booking.customerId, 'Booking Completed', `Your booking for ${booking.service.name} has been completed. Thank you!`, { bookingId: id }, NotificationType.WORK_COMPLETED).catch(() => {});

    return { success: true, message: 'Booking completed', data: updated };
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────────

  async cancel(id: string, actorId: string, dto: CancelBookingDto) {
    const booking = await this.requireBookingWithService(id);

    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    const isOwner = booking.customerId === actorId;
    const isPrivileged = actor?.role === Role.ADMIN || actor?.role === Role.MANAGER || actor?.role === Role.SUPER_ADMIN;
    // Worker Panel "Cancel" — only before they've accepted the job (mock UI only offers
    // Cancel while the job is still in its initial 'assigned' state).
    const isAssignedWorker =
      actor?.role === Role.WORKER &&
      booking.workerId === actorId &&
      booking.status === BookingStatus.ASSIGNED &&
      !booking.workerAcceptedAt;

    if (!isOwner && !isPrivileged && !isAssignedWorker) {
      throw new ForbiddenException('You do not have permission to cancel this booking');
    }
    this.assertNotTerminal(booking.status);
    this.assertTransition(booking.status, BookingStatus.CANCELLED);

    if (booking.timeSlotId) await this.releaseSlot(booking.timeSlotId);

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date(), cancelReason: dto.reason },
      include: BOOKING_INCLUDE,
    });

    await this.recordStatusHistory(id, BookingStatus.CANCELLED, actorId, dto.reason);
    this.audit(actorId, id, AuditAction.STATUS_CHANGE, { status: BookingStatus.CANCELLED, reason: dto.reason });
    this.activityLog.log({
      action: ActivityAction.BOOKING_CANCELLED,
      module: ActivityModule.BOOKING,
      description: `Booking ${booking.bookingRef ?? id} cancelled — ${booking.service.name}`,
      actor: { id: actorId, name: 'Actor', role: actor?.role ?? Role.USER },
      target: { id: booking.id, type: 'Booking' },
      metadata: { bookingRef: booking.bookingRef, reason: dto.reason },
    });

    const notifyId = actorId === booking.customerId ? booking.workerId : booking.customerId;
    if (notifyId) {
      this.notifications.notify(notifyId, 'Booking Cancelled', `Booking for ${booking.service.name} has been cancelled.${dto.reason ? ' Reason: ' + dto.reason : ''}`, { bookingId: id }).catch(() => {});
    }

    return { success: true, message: 'Booking cancelled', data: updated };
  }

  // ─── No-show / Reschedule ─────────────────────────────────────────────────────

  async markNoShow(id: string, actorId: string) {
    const booking = await this.requireBookingWithService(id);
    this.assertTransition(booking.status, BookingStatus.NO_SHOW);

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.NO_SHOW },
      include: BOOKING_INCLUDE,
    });

    await this.recordStatusHistory(id, BookingStatus.NO_SHOW, actorId);
    this.audit(actorId, id, AuditAction.STATUS_CHANGE, { status: BookingStatus.NO_SHOW });

    return { success: true, message: 'Booking marked as no-show', data: updated };
  }

  async reschedule(id: string, customerId: string, dto: RescheduleBookingDto) {
    const booking = await this.requireBookingWithService(id);
    this.assertOwner(booking, customerId);
    this.assertNotTerminal(booking.status);
    this.assertTransition(booking.status, BookingStatus.RESCHEDULED);

    if (dto.scheduledAt < new Date()) throw new BadRequestException('Rescheduled date must be in the future');

    const previousTimeSlotId = booking.timeSlotId;
    const isSlotChanging = !!dto.timeSlotId && dto.timeSlotId !== booking.timeSlotId;
    if (isSlotChanging) {
      // Validates the new slot exists, belongs to this booking's service, is marked available,
      // and has remaining capacity — throws NotFoundException/BadRequestException otherwise.
      await this.validateAndClaimSlot(dto.timeSlotId!, booking.serviceId);
    }

    // Move the booking onto the new slot FIRST, then reconcile availability for both slots
    // afterward. Reconciling the old slot before this update ran (the previous bug) computed
    // its active-booking count while this booking's timeSlotId still pointed at it, so the old
    // slot was never actually freed up.
    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status:      BookingStatus.RESCHEDULED,
        scheduledAt: dto.scheduledAt,
        timeSlotId:  dto.timeSlotId ?? booking.timeSlotId,
        notes:       dto.reason ? `${booking.notes ?? ''}\n[Reschedule] ${dto.reason}`.trim() : booking.notes,
      },
      include: BOOKING_INCLUDE,
    });

    await this.recordStatusHistory(id, BookingStatus.RESCHEDULED, customerId, dto.reason);
    this.audit(customerId, id, AuditAction.UPDATE, { scheduledAt: dto.scheduledAt, timeSlotId: updated.timeSlotId });

    if (isSlotChanging) {
      if (previousTimeSlotId) {
        this.reconcileSlotAvailability(previousTimeSlotId, BookingStatus.CANCELLED)
          .catch((err: Error) => this.logger.error(`[reschedule] releasing old slot failed (non-fatal, background): ${err.message}`));
      }
      this.reconcileSlotAvailability(dto.timeSlotId!, BookingStatus.RESCHEDULED)
        .catch((err: Error) => this.logger.error(`[reschedule] reserving new slot failed (non-fatal, background): ${err.message}`));
    }

    if (booking.workerId) {
      this.notifications.notify(booking.workerId, 'Booking Rescheduled', `A booking for ${booking.service.name} has been rescheduled to ${dto.scheduledAt.toISOString().slice(0, 10)}.`, { bookingId: id }).catch(() => {});
    }

    return { success: true, message: 'Booking rescheduled', data: updated };
  }

  // ─── Preview ──────────────────────────────────────────────────────────────────
  // Pre-booking price breakdown — no persistence. servicePrice is read directly from the
  // selected PricingOption, the exact same value create() charges, so the two can never drift.
  async previewPrice(dto: PreviewBookingPriceDto) {
    const pricingOption = await this.prisma.pricingOption.findUnique({
      where: { id: dto.pricingOptionId },
      select: { id: true, packageId: true, isActive: true, price: true },
    });
    if (!pricingOption) throw new NotFoundException('Pricing option not found');
    if (pricingOption.packageId !== dto.packageId) {
      throw new BadRequestException('Pricing option does not belong to the selected package');
    }
    if (!pricingOption.isActive) throw new BadRequestException('Pricing option is not available for booking');

    const servicePrice = r2(pricingOption.price);
    const { taxPercentage, advancePaymentPercentage } = await this.getOrgPaymentSettings();

    const gst = r2((servicePrice * taxPercentage) / 100);
    // total/advance/remaining are whole-rupee amounts (what's actually stored on the
    // booking and charged via Razorpay) — remaining is derived from the rounded total
    // and advance, not independently rounded, so advance + remaining always equals total.
    const total = r0(servicePrice + gst);
    const advance = r0((total * advancePaymentPercentage) / 100);
    const remaining = total - advance;

    return { success: true, data: { servicePrice, gst, total, advance, remaining } };
  }

  // ─── Payment (Booking Payment screen) ──────────────────────────────────────────
  // Advance payment collected online at booking time — distinct from the worker's in-person
  // cash/QR collection and from the post-COMPLETED formal invoice (InvoicesService.generateFromBooking).

  async getPaymentConfig(bookingId: string, customerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { invoice: { include: { payments: { where: { status: 'SUCCESS' } } } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    this.assertOwner(booking, customerId);

    if (booking.invoice) {
      const paid = r2(booking.invoice.payments.reduce((s, p) => s + p.amount, 0));
      return {
        success: true,
        data: {
          tax: booking.invoice.taxAmount,
          advancePayment: booking.invoice.taxableAmount,
          total: booking.invoice.total,
          remaining: Math.max(0, r2(booking.invoice.total - paid)),
        },
      };
    }

    const advancePayment = r0(booking.advanceAmount ?? booking.totalAmount ?? 0);
    const tax = r2((advancePayment * 18) / 100);
    const total = r0(advancePayment + tax);
    return { success: true, data: { tax, advancePayment, total, remaining: total } };
  }

  async createPaymentOrder(bookingId: string, customerId: string, paymentType: PaymentType, orgId?: string) {
    const t0 = Date.now();
    this.logger.debug(`[razorpay-order] START bookingId=${bookingId} paymentType=${paymentType} (+0ms)`);

    try {
      this.logger.debug(`[razorpay-order] booking lookup START (+${Date.now() - t0}ms)`);
      const booking = await this.requireBookingWithService(bookingId);
      this.logger.debug(`[razorpay-order] booking lookup END (+${Date.now() - t0}ms) status=${booking.status}`);

      this.assertOwner(booking, customerId);
      // PENDING_PAYMENT (original case, paying the advance/full amount at booking time) is
      // always payable. Any other NON-terminal status is also payable — this is what makes
      // collecting the REMAINING balance later (after the advance has already been paid and
      // the booking has moved on to PENDING/CONFIRMED/ASSIGNED/IN_PROGRESS) possible at all;
      // previously this status gate hard-blocked it, the only way to collect the remainder was
      // the Worker's cash/QR collectPayment() (no real Razorpay flow, no amount tracked). A
      // booking that's already COMPLETED/CANCELLED/NO_SHOW has nothing left to pay for.
      if (booking.status !== BookingStatus.PENDING_PAYMENT && TERMINAL_STATUSES.includes(booking.status)) {
        throw new BadRequestException('This booking is not awaiting payment');
      }

      this.logger.debug(`[razorpay-order] invoice START (+${Date.now() - t0}ms)`);
      const invoice = await this.invoicesService.ensureAdvanceInvoice(bookingId, customerId, paymentType);
      this.logger.debug(`[razorpay-order] invoice END (+${Date.now() - t0}ms) invoiceId=${invoice.id} total=${invoice.total}`);

      // Amount calculation and the Razorpay API call happen inside PaymentsService
      // .createRazorpayOrder() — it logs its own [razorpay-order] amount calculation and
      // [razorpay-order] razorpay API markers, so the trace stays linear and complete under
      // this one prefix regardless of which class emits which step.
      const order = await this.paymentsService.createRazorpayOrder({ invoiceId: invoice.id, paymentType }, customerId, orgId);

      this.logger.debug(`[razorpay-order] database update START (+${Date.now() - t0}ms)`);
      // Reset payment tracking for this attempt (e.g. retrying after a previously failed/abandoned order).
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: PaymentStatus.CREATED, razorpayOrderId: order.data.razorpayOrderId },
      });
      this.logger.debug(`[razorpay-order] database update END (+${Date.now() - t0}ms)`);

      this.logger.debug(`[razorpay-order] RESPONSE (+${Date.now() - t0}ms total) razorpayOrderId=${order.data.razorpayOrderId}`);
      return order;
    } catch (err) {
      // Never swallowed — logged with total elapsed time then rethrown as-is, so this always
      // reaches the global exception filter and returns an HTTP response (never left hanging).
      // The last logged START without a matching END above pinpoints exactly which step was
      // in flight when it failed.
      this.logger.error(`[razorpay-order] FAILED after ${Date.now() - t0}ms: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }

  // New simplified verify endpoint: POST /bookings/:id/payment/verify — takes only the three
  // fields Razorpay returns (razorpay_payment_id, razorpay_order_id, razorpay_signature),
  // identical whether they came from the Native SDK or Web Checkout — both hand the frontend
  // the same three fields, so both go through this exact same verification logic with no
  // branching. Resolves the internal Payment via its Transaction, so the caller never needs to
  // know our internal paymentId. Booking only ever moves PENDING_PAYMENT → PENDING once the
  // signature is verified SUCCESS; on failure/cancellation the booking stays PENDING_PAYMENT
  // and paymentStatus is set FAILED.
  async verifyBookingPayment(bookingId: string, dto: VerifyBookingPaymentDto, actor: AuthUser, orgId?: string) {
    const booking = await this.requireBookingWithService(bookingId);
    this.assertOwner(booking, actor.id);

    const transaction = await this.prisma.transaction.findUnique({
      where: { razorpayOrderId: dto.razorpay_order_id },
      select: { paymentId: true, payment: { select: { invoice: { select: { bookingId: true } } } } },
    });
    if (!transaction || transaction.payment.invoice?.bookingId !== bookingId) {
      throw new NotFoundException('Payment not found for this booking');
    }

    try {
      const result = await this.paymentsService.verifyRazorpay(
        {
          paymentId: transaction.paymentId,
          razorpayOrderId: dto.razorpay_order_id,
          razorpayPaymentId: dto.razorpay_payment_id,
          razorpaySignature: dto.razorpay_signature,
        },
        actor,
        orgId,
      );

      const payment = result.data;
      if (!payment) throw new NotFoundException('Payment not found');
      const shouldAdvance = booking.status === BookingStatus.PENDING_PAYMENT;

      const updated = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          ...(shouldAdvance && { status: BookingStatus.PENDING }),
          paymentStatus: PaymentStatus.SUCCESS,
          razorpayOrderId: dto.razorpay_order_id,
          razorpayPaymentId: dto.razorpay_payment_id,
          razorpaySignature: dto.razorpay_signature,
          paidAmount: payment.paidAmount ?? payment.amount,
          paidAt: payment.paidAt ?? new Date(),
          paymentMethod: PaymentMethod.RAZORPAY,
        },
        include: BOOKING_INCLUDE,
      });

      if (shouldAdvance) {
        await this.recordStatusHistory(bookingId, BookingStatus.PENDING, actor.id, 'Payment verified — awaiting manager confirmation');
        this.audit(actor.id, bookingId, AuditAction.STATUS_CHANGE, { status: BookingStatus.PENDING, reason: 'payment' });
        this.notifications
          .notify(booking.customerId, 'Payment Successful', `Payment received for your booking for ${booking.service.name}.`, { bookingId })
          .catch(() => {});
      }

      return {
        success: true,
        message: shouldAdvance ? 'Payment verified successfully' : 'Payment verified',
        data: { payment: result.data, booking: updated },
      };
    } catch (err) {
      // Signature invalid, already-processed, etc. — booking stays exactly where it was;
      // only paymentStatus reflects the failed attempt.
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PaymentStatus.FAILED,
          razorpayOrderId: dto.razorpay_order_id,
          razorpayPaymentId: dto.razorpay_payment_id,
          razorpaySignature: dto.razorpay_signature,
        },
      });
      throw err;
    }
  }

  async verifyPaymentAndConfirm(bookingId: string, dto: VerifyRazorpayDto, actor: AuthUser, orgId?: string) {
    const t0 = Date.now();
    this.logger.debug(`[razorpay-verify] START (+0ms) bookingId=${bookingId} razorpayPaymentId=${dto.razorpayPaymentId}`);

    try {
      this.logger.debug(`[razorpay-verify] booking lookup START (+${Date.now() - t0}ms)`);
      const booking = await this.requireBookingWithService(bookingId);
      this.logger.debug(`[razorpay-verify] booking lookup END (+${Date.now() - t0}ms) status=${booking.status}`);
      this.assertOwner(booking, actor.id);

      // Delegates to PaymentsService.verifyRazorpay(), which logs its own [razorpay-verify]
      // payment lookup / signature verification / DB transaction / response preparation steps —
      // see that method for the breakdown of this span. It is itself idempotent: a retried
      // razorpayPaymentId for an already-SUCCESS payment re-serves the same result instead of
      // writing anything or erroring, so a client retry after a lost response is always safe.
      const result = await this.paymentsService.verifyRazorpay(dto, actor, orgId);
      this.logger.debug(`[razorpay-verify] payment verification complete (+${Date.now() - t0}ms)`);

      if (booking.status === BookingStatus.PENDING_PAYMENT) {
        this.logger.debug(`[razorpay-verify] booking update START (+${Date.now() - t0}ms)`);
        // Root cause of "paid amount / payment method / transaction id missing on the booking
        // detail screen": this update used to only touch status/paymentStatus — the actual
        // paidAmount, paidAt, method, and razorpayPaymentId that verifyRazorpay() already
        // computed and persisted onto the Payment/Transaction rows were never copied onto the
        // Booking itself, unlike the sibling verifyBookingPayment() flow below which does. Mirror
        // that here so both verification paths leave the Booking row fully populated.
        const verifiedPayment = result.data;
        const updated = await this.prisma.booking.update({
          where: { id: bookingId },
          data: {
            status: BookingStatus.PENDING,
            paymentStatus: PaymentStatus.SUCCESS,
            ...(verifiedPayment && {
              razorpayPaymentId: verifiedPayment.transactions?.[0]?.razorpayPaymentId ?? dto.razorpayPaymentId,
              paidAmount: verifiedPayment.paidAmount ?? verifiedPayment.amount,
              paidAt: verifiedPayment.paidAt ?? new Date(),
              paymentMethod: PaymentMethod.RAZORPAY,
            }),
          },
          include: BOOKING_INCLUDE,
        });
        this.logger.debug(`[razorpay-verify] booking update END (+${Date.now() - t0}ms)`);

        // Non-critical post-payment work, moved off the response path. The booking's
        // status/paymentStatus write above (the fact that matters to the client and to any
        // other request racing against this one) is already committed. None of the following
        // — audit-trail history, slot-capacity bookkeeping, the push notification — is
        // something the client is waiting on or gates any decision on in this response, and a
        // failure in any of them must never turn this already-successful payment into a
        // frontend-visible failure (they're logged, not rethrown). Previously these ran
        // sequentially and awaited before the response — in production that pair alone (status
        // history + slot reconciliation) measured ~1s on top of an already-slow booking update.
        this.logger.debug(`[razorpay-verify] queuing background post-processing (+${Date.now() - t0}ms): status history, slot reconciliation, notification`);
        this.recordStatusHistory(bookingId, BookingStatus.PENDING, actor.id, 'Payment verified — awaiting manager confirmation')
          .catch((err: Error) => this.logger.error(`[razorpay-verify] recordStatusHistory failed (non-fatal, background): ${err.message}`));
        this.audit(actor.id, bookingId, AuditAction.STATUS_CHANGE, { status: BookingStatus.PENDING, reason: 'payment' });

        // Only now — payment verified successful — does this booking actually reserve slot
        // capacity. Recompute the slot's active count and flip isAvailable if it's now full.
        if (booking.timeSlotId) {
          this.reconcileSlotAvailability(booking.timeSlotId, BookingStatus.PENDING)
            .catch((err: Error) => this.logger.error(`[razorpay-verify] reconcileSlotAvailability failed (non-fatal, background): ${err.message}`));
        }

        this.notifications
          .notify(booking.customerId, 'Payment Successful', `Payment received for your booking for ${booking.service.name}.`, { bookingId })
          .catch(() => {});

        // Booking confirmation + payment receipt emails. Root cause of "emails are never
        // received": these EmailService methods existed but were never called from anywhere in
        // the booking/payment flow — EmailService wasn't even injected into this service. Fired
        // here, inside the `booking.status === PENDING_PAYMENT` guard, for the same reason the
        // status history / notification above are: this block only runs on the ONE request that
        // actually transitions the booking out of PENDING_PAYMENT. A retried/idempotent-replay
        // verifyRazorpay call finds booking.status already PENDING and takes the other return
        // branch entirely, so these never fire twice for the same booking — no extra dedupe
        // needed. Fire-and-forget: an email provider failure must never surface as a failure of
        // an already-successful payment.
        if (result.data) {
          this.sendPostPaymentEmails(updated, result.data, bookingId).catch(() => {});
        }

        this.logger.debug(`[razorpay-verify] RESPONSE (+${Date.now() - t0}ms total)`);
        return { success: true, message: 'Payment verified successfully', data: { payment: result.data, booking: updated } };
      }

      this.logger.debug(`[razorpay-verify] RESPONSE (+${Date.now() - t0}ms total) — booking already past PENDING_PAYMENT, no state change needed`);
      return { success: true, message: 'Payment verified', data: { payment: result.data, booking } };
    } catch (err) {
      // Never swallowed — logged with total elapsed time then rethrown as-is, so this always
      // reaches the global exception filter and returns an HTTP response (never left hanging).
      this.logger.error(`[razorpay-verify] FAILED after ${Date.now() - t0}ms: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private buildWhere(filters: {
    status?: BookingStatus;
    customerId?: string;
    workerId?: string;
    managerId?: string;
    serviceId?: string;
    scheduledFrom?: Date;
    scheduledTo?: Date;
  }): Prisma.BookingWhereInput {
    const where: Prisma.BookingWhereInput = {};
    if (filters.status)     where.status     = filters.status;
    if (filters.customerId) where.customerId  = filters.customerId;
    if (filters.workerId)   where.workerId    = filters.workerId;
    if (filters.managerId)  where.managerId   = filters.managerId;
    if (filters.serviceId)  where.serviceId   = filters.serviceId;
    if (filters.scheduledFrom || filters.scheduledTo) {
      where.scheduledAt = {};
      if (filters.scheduledFrom) where.scheduledAt.gte = filters.scheduledFrom;
      if (filters.scheduledTo)   where.scheduledAt.lte = filters.scheduledTo;
    }
    return where;
  }

  private async requireBooking(id: string): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async requireBookingWithService(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { service: { select: { id: true, name: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private assertTransition(from: BookingStatus, to: BookingStatus): void {
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Cannot transition booking from ${from} to ${to}`);
    }
  }

  private assertNotTerminal(status: BookingStatus): void {
    if (TERMINAL_STATUSES.includes(status)) {
      throw new BadRequestException(`Booking is already in a terminal state: ${status}`);
    }
  }

  private assertOwner(booking: { customerId: string }, userId: string): void {
    if (booking.customerId !== userId) throw new ForbiddenException('This booking does not belong to you');
  }

  // Same paidAmount/remainingAmount derivation getSummary() already uses — never advanceAmount,
  // never the raw (possibly stale after a second payment attempt) Booking.paidAmount column.
  // paidAmount is the live sum of this booking's invoice's SUCCESS payments (correctly includes
  // BOTH the advance and any later remaining-balance payment, each its own Payment row), or the
  // full total if the worker's in-person cash/QR collection settled it.
  private async getRemainingAmount(bookingId: string): Promise<number> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        totalAmount: true,
        paidAmount: true,
        paymentCollectedAt: true,
        invoice: { select: { payments: { where: { status: PaymentStatus.SUCCESS }, select: { amount: true } } } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const totalAmount = r0(booking.totalAmount ?? 0);
    const onlinePaid = booking.invoice
      ? r2(booking.invoice.payments.reduce((sum, p) => sum + p.amount, 0))
      : (booking.paidAmount ?? 0);
    const paidAmount = booking.paymentCollectedAt ? totalAmount : r0(onlinePaid);
    return Math.max(0, totalAmount - paidAmount);
  }

  // Business rule: a job can only be assigned to a Worker who is currently on duty — active,
  // not on approved leave today, and has a currently-OPEN check-in session for TODAY (checking
  // in then checking out still blocks assignment; an open session from a previous day does not
  // count — see getTodayRange). Reuses the exact same "open session for today" query
  // AttendanceService already uses everywhere else (attendance.service.ts) rather than
  // inventing a second attendance-status system; duplicated here (not injected) because
  // BookingsModule doesn't import AttendanceModule — same reasoning as
  // TasksService.assertWorkerOnDuty, kept identical to it.
  private async assertWorkerOnDuty(workerId: string): Promise<void> {
    const NOT_ON_DUTY_MESSAGE = 'Worker is not checked in. Task cannot be assigned until the worker checks in.';

    const { start, end } = getTodayRange();

    // Same exact-match convention leave-request.service.ts's own duplicate-date check already
    // uses (WorkerLeaveRequest.date is stored as new Date(dateOnlyString), i.e. UTC midnight of
    // that calendar date) — not getTodayRange's local-time window, which is specific to
    // Attendance.checkInTime (a true timestamp), a different field with different semantics.
    const todayDateOnly = new Date(new Date().toISOString().split('T')[0]);
    const onApprovedLeave = await this.prisma.workerLeaveRequest.findFirst({
      where: { workerId, status: LeaveRequestStatus.APPROVED, date: todayDateOnly },
      select: { id: true },
    });
    if (onApprovedLeave) throw new BadRequestException(NOT_ON_DUTY_MESSAGE);

    const openSession = await this.prisma.attendance.findFirst({
      where: { userId: workerId, checkInTime: { gte: start, lt: end }, status: AttendanceStatus.CHECKED_IN },
      select: { id: true },
    });
    if (!openSession) throw new BadRequestException(NOT_ON_DUTY_MESSAGE);
  }

  private async recordStatusHistory(
    bookingId: string,
    status: BookingStatus,
    actorId?: string,
    note?: string,
  ): Promise<void> {
    await this.prisma.bookingStatusHistory.create({ data: { bookingId, status, actorId, note } });
  }

  // Fires the booking confirmation + payment receipt emails after a successful payment
  // verification. Never throws — every failure is caught and logged individually so one
  // email failing can never affect the other, or the (already-returned) payment/booking result.
  private async sendPostPaymentEmails(
    booking: { bookingRef: string | null; scheduledAt: Date; totalAmount: number | null; service: { name: string }; customer: { name: string; email: string } },
    payment: { id: string; paidAmount: number | null; paidAt: Date | null },
    bookingId: string,
  ): Promise<void> {
    const to = booking.customer.email;
    const maskedTo = maskEmail(to);
    const bookingRef = booking.bookingRef ?? bookingId;

    const confirmationStartedAt = Date.now();
    this.logger.log(`[EMAIL] booking confirmation START bookingId=${bookingId} recipient=${maskedTo}`);
    try {
      const result = await this.emailService.sendBookingConfirmationEmail({
        to,
        name: booking.customer.name,
        bookingRef,
        serviceName: booking.service.name,
        scheduledDate: booking.scheduledAt.toISOString().slice(0, 10),
        amount: booking.totalAmount != null ? `₹${booking.totalAmount}` : undefined,
      });
      const duration = Date.now() - confirmationStartedAt;
      if (result.accepted) {
        this.logger.log(`[EMAIL] booking confirmation SENT bookingId=${bookingId} recipient=${maskedTo} messageId=${result.messageId ?? 'n/a'} durationMs=${duration}`);
      } else {
        this.logger.error(`[EMAIL] booking confirmation FAILED bookingId=${bookingId} recipient=${maskedTo} durationMs=${duration} reason=${result.error ?? 'unknown'}`);
      }
    } catch (err) {
      this.logger.error(`[EMAIL] booking confirmation FAILED bookingId=${bookingId} recipient=${maskedTo} durationMs=${Date.now() - confirmationStartedAt} reason=${(err as Error).message}`);
    }

    const receiptStartedAt = Date.now();
    this.logger.log(`[EMAIL] payment receipt START bookingId=${bookingId} paymentId=${payment.id} recipient=${maskedTo}`);
    try {
      const result = await this.emailService.sendPaymentReceiptEmail({
        to,
        name: booking.customer.name,
        bookingRef,
        paymentId: payment.id,
        amount: `₹${payment.paidAmount ?? 0}`,
        paymentDate: (payment.paidAt ?? new Date()).toISOString().slice(0, 10),
      });
      const duration = Date.now() - receiptStartedAt;
      if (result.accepted) {
        this.logger.log(`[EMAIL] payment receipt SENT bookingId=${bookingId} paymentId=${payment.id} recipient=${maskedTo} messageId=${result.messageId ?? 'n/a'} durationMs=${duration}`);
      } else {
        this.logger.error(`[EMAIL] payment receipt FAILED bookingId=${bookingId} paymentId=${payment.id} recipient=${maskedTo} durationMs=${duration} reason=${result.error ?? 'unknown'}`);
      }
    } catch (err) {
      this.logger.error(`[EMAIL] payment receipt FAILED bookingId=${bookingId} paymentId=${payment.id} recipient=${maskedTo} durationMs=${Date.now() - receiptStartedAt} reason=${(err as Error).message}`);
    }
  }

  private async getOrgPaymentSettings(): Promise<{ taxPercentage: number; advancePaymentPercentage: number }> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: [SETTING_KEYS.taxPercentage, SETTING_KEYS.advancePaymentPercentage] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, Number(r.value)]));
    return {
      taxPercentage: map.get(SETTING_KEYS.taxPercentage) ?? DEFAULTS.taxPercentage,
      advancePaymentPercentage: map.get(SETTING_KEYS.advancePaymentPercentage) ?? DEFAULTS.advancePaymentPercentage,
    };
  }

  // Called at booking creation. A newly created booking is PENDING_PAYMENT — it must be
  // allowed to exist without consuming capacity, so this only rejects when the slot is
  // already full of bookings that have actually paid (ACTIVE_BOOKING_STATUSES).
  private async validateAndClaimSlot(timeSlotId: string, serviceId: string): Promise<void> {
    const slot = await this.prisma.timeSlot.findUnique({
      where: { id: timeSlotId },
      select: {
        id: true,
        serviceId: true,
        isAvailable: true,
        capacity: true,
        _count: { select: { bookings: { where: { status: { in: ACTIVE_BOOKING_STATUSES } } } } },
      },
    });
    if (!slot) throw new NotFoundException('Time slot not found');
    if (slot.serviceId !== serviceId) throw new BadRequestException('Time slot does not belong to the selected service');
    if (!slot.isAvailable) throw new BadRequestException('Time slot is not available');

    const activeBookingCount = slot._count.bookings;
    const remainingCapacity = slot.capacity - activeBookingCount;
    this.logger.debug(
      `[validateAndClaimSlot] Booking Status: PENDING_PAYMENT (not yet created) | ` +
        `Slot Capacity: ${slot.capacity} | Active Booking Count: ${activeBookingCount} | ` +
        `Remaining Capacity: ${remainingCapacity} | Reservation Triggered: false (capacity check only, no reservation happens at creation)`,
    );

    if (activeBookingCount >= slot.capacity) throw new BadRequestException('Time slot is fully booked');
  }

  // Called after a booking's payment is verified successful (see verifyPaymentAndConfirm) and
  // whenever a booking is cancelled/released. Recomputes the slot's active-booking count and
  // flips TimeSlot.isAvailable to reflect whether it's actually full — this is the only place
  // isAvailable is now touched automatically; it stays a manual admin override otherwise.
  private async reconcileSlotAvailability(timeSlotId: string, bookingStatus: BookingStatus): Promise<void> {
    const slot = await this.prisma.timeSlot.findUnique({
      where: { id: timeSlotId },
      select: {
        id: true,
        capacity: true,
        isAvailable: true,
        _count: { select: { bookings: { where: { status: { in: ACTIVE_BOOKING_STATUSES } } } } },
      },
    });
    if (!slot) return;

    const activeBookingCount = slot._count.bookings;
    const remainingCapacity = slot.capacity - activeBookingCount;
    const isFull = activeBookingCount >= slot.capacity;
    const reservationTriggered = isFull && slot.isAvailable;

    this.logger.debug(
      `[reconcileSlotAvailability] Booking Status: ${bookingStatus} | Slot Capacity: ${slot.capacity} | ` +
        `Active Booking Count: ${activeBookingCount} | Remaining Capacity: ${remainingCapacity} | ` +
        `Reservation Triggered: ${reservationTriggered}`,
    );

    if (isFull && slot.isAvailable) {
      await this.prisma.timeSlot.update({ where: { id: timeSlotId }, data: { isAvailable: false } });
    } else if (!isFull && !slot.isAvailable) {
      await this.prisma.timeSlot.update({ where: { id: timeSlotId }, data: { isAvailable: true } });
    }
  }

  // Kept for the cancel/reschedule call sites — cancelling a booking never increases the
  // active count, so this always resolves to the "re-open the slot if it has room" branch of
  // reconcileSlotAvailability above.
  private async releaseSlot(timeSlotId: string): Promise<void> {
    await this.reconcileSlotAvailability(timeSlotId, BookingStatus.CANCELLED);
  }

  private async generateRef(): Promise<string> {
    const count = await this.prisma.booking.count();
    return `BK-${String(count + 1).padStart(6, '0')}`;
  }

  private audit(actorId: string, entityId: string, action: AuditAction, newValue?: unknown) {
    this.auditLogs
      .log({ actorId, entityType: 'Booking', entityId, action, newValue: newValue as Record<string, unknown> })
      .catch(() => {});
  }
}
