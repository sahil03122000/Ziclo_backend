import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { VerifyRazorpayDto } from '../../invoicing/payments/dto/verify-razorpay.dto';
import { BookingsService } from './bookings.service';
import { AddBookingPhotoDto } from './dto/add-booking-photo.dto';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { AssignWorkerDto } from './dto/assign-worker.dto';
import { BookingQueryDto } from './dto/booking-query.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CollectPaymentDto } from './dto/collect-payment.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { PreviewBookingPriceDto } from './dto/preview-booking-price.dto';
import { VerifyBookingPaymentDto } from './dto/verify-booking-payment.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';
import { StartBookingDto } from './dto/start-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

@ApiTags('Booking / Bookings')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // ─── Scoped list routes — must come before /:id ───────────────────────────

  @Get('customer/me')
  @Roles(Role.USER, Role.WORKER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: "Authenticated user's own booking history — all roles" })
  @ApiResponse({ status: 200, description: 'Paginated booking list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getMyBookings(@CurrentUser() user: AuthUser, @Query() query: BookingQueryDto) {
    return this.bookingsService.getMyBookings(user.id, query);
  }

  @Get('manager/me')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Bookings under my management — MANAGER / ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated booking list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — MANAGER or ADMIN required' })
  getManagerBookings(@CurrentUser() user: AuthUser, @Query() query: BookingQueryDto) {
    return this.bookingsService.getManagerBookings(user.id, query);
  }

  @Get('worker/me')
  @Roles(Role.WORKER)
  @ApiOperation({ summary: 'Jobs assigned to me — WORKER (Worker Panel: Home / Jobs)' })
  @ApiResponse({ status: 200, description: 'Paginated job list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — WORKER role required' })
  getWorkerBookings(@CurrentUser() user: AuthUser, @Query() query: BookingQueryDto) {
    return this.bookingsService.getWorkerBookings(user.id, query);
  }

  @Get('worker/me/:id')
  @Roles(Role.WORKER)
  @ApiOperation({ summary: 'Job detail — WORKER (Worker Panel: Job Details)' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Job detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — not assigned to you' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  getWorkerJobById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookingsService.getWorkerJobById(id, user.id);
  }

  @Get('customer/:customerId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Full booking history for a specific customer — ADMIN / MANAGER' })
  @ApiParam({ name: 'customerId', description: 'Customer (User) UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Paginated booking list for customer' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getCustomerHistory(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: BookingQueryDto,
  ) {
    return this.bookingsService.getCustomerHistory(customerId, query);
  }

  // ─── Core CRUD ────────────────────────────────────────────────────────────

  @Post()
  @Roles(Role.USER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Create a booking',
    description:
      'Creates a booking following the Service → Property Type → Package → Date → Time Slot → Address flow:\n\n' +
      '- `serviceId` / `propertyTypeId` / `packageId` — must form a valid chain (package belongs to property type belongs to service)\n' +
      '- `packageId` price is locked into the booking at creation\n' +
      '- `timeSlotId` — must belong to `serviceId` and have capacity\n' +
      '- `addressId` — saved address UUID from `GET /addresses`, must belong to the requesting customer\n\n' +
      'A unique `bookingRef` (e.g. `BK-000042`) is assigned.',
  })
  @ApiResponse({
    status: 201,
    description: 'Booking created with status PENDING',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          bookingRef: 'BK-000042',
          status: 'PENDING',
          totalAmount: 499,
          scheduledAt: '2026-07-10T00:00:00Z',
          service: { id: 'uuid', name: 'Solar Cleaning' },
          propertyType: { id: 'uuid', name: 'Residential' },
          package: { id: 'uuid', name: '1-3 KW', price: 499 },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error — invalid property type/package chain, inactive service/package, or missing address' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Service, property type, package, time slot, or address not found' })
  create(@Body() dto: CreateBookingDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.bookingsService.create(dto, user.id, (req as any).organizationId);
  }

  @Post('preview-price')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Preview the price for a package + selection option before booking',
    description:
      'No persistence — uses the exact same price resolution as booking creation. If the selected ' +
      'additional option has a finalPrice set, that replaces the package price outright; otherwise the ' +
      'package price is used as-is (or adjusted by the option\'s amount/adjustmentType, for options not yet ' +
      'migrated to finalPrice).',
  })
  @ApiResponse({
    status: 200,
    description: 'Price breakdown',
    schema: { example: { success: true, data: { servicePrice: 699, gst: 125.82, total: 824.82, advance: 164.96, remaining: 659.86 } } },
  })
  @ApiResponse({ status: 400, description: 'Package inactive or additional option does not belong to the service' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  previewPrice(@Body() dto: PreviewBookingPriceDto) {
    return this.bookingsService.previewPrice(dto);
  }

  // ─── Payment (Booking Payment screen) ──────────────────────────────────────

  @Get(':id/payment-config')
  @Roles(Role.USER)
  @ApiOperation({ summary: 'Get payment config for a booking — tax, advance payment, total, remaining — USER' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment config' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  getPaymentConfig(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookingsService.getPaymentConfig(id, user.id);
  }

  @Post(':id/payment/razorpay-order')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Create a Razorpay order for a booking\'s advance or full payment — USER',
    description: 'Auto-generates (or rebuilds, if not yet paid) the invoice for the requested paymentType on each call. Rejects if the booking is not PENDING (already paid/confirmed).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Razorpay order created' })
  @ApiResponse({ status: 400, description: 'Booking is not awaiting payment' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  createPaymentOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentOrderDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bookingsService.createPaymentOrder(id, user.id, dto.paymentType, (req as any).organizationId);
  }

  @Post(':id/payment/razorpay-verify')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Verify Razorpay payment and confirm the booking — USER',
    description: 'Verifies the payment signature, marks the advance invoice PAID, and transitions the booking PENDING → CONFIRMED. Idempotent.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment verified and booking confirmed' })
  @ApiResponse({ status: 400, description: 'Signature verification failed or payment already processed' })
  @ApiResponse({ status: 404, description: 'Booking or payment not found' })
  verifyPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyRazorpayDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bookingsService.verifyPaymentAndConfirm(id, dto, user, (req as any).organizationId);
  }

  @Post(':id/payment/verify')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Verify a booking payment (Razorpay Checkout callback) — USER',
    description:
      'Takes only the fields Razorpay Checkout returns on success. Verifies the signature; on success ' +
      'sets paymentStatus SUCCESS and transitions the booking PENDING → CONFIRMED. On failure (bad signature ' +
      'or already-processed), paymentStatus is set FAILED and the booking status is left unchanged — it is ' +
      'never marked CONFIRMED before a successful verification.',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment verified and booking confirmed' })
  @ApiResponse({ status: 400, description: 'Signature verification failed or payment already processed' })
  @ApiResponse({ status: 404, description: 'Booking or payment not found' })
  verifyBookingPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyBookingPaymentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bookingsService.verifyBookingPayment(id, dto, user, (req as any).organizationId);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all bookings with filters — ADMIN' })
  @ApiResponse({ status: 200, description: 'Paginated booking list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  findAll(@Query() query: BookingQueryDto, @Req() req: Request) {
    return this.bookingsService.findAll(query, (req as any).organizationId);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Get booking detail — includes step values, package, add-ons, status history — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking detail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.findOne(id);
  }

  @Get(':id/summary')
  @Roles(Role.USER, Role.ADMIN, Role.MANAGER, Role.WORKER)
  @ApiOperation({
    summary: 'Get dynamic booking summary',
    description:
      'Returns a human-readable summary of the booking: step answers, selected package, add-ons, address, and pricing breakdown. ' +
      'Useful for confirmation screens and service sheets.',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Booking summary',
    schema: {
      example: {
        success: true,
        data: {
          bookingRef: 'BK-000042',
          service: { name: 'AC Cleaning', slug: 'ac-cleaning' },
          steps: [{ label: 'Property Type', value: '2BHK' }, { label: 'AC Units', value: 2 }],
          package: { name: 'Standard Clean', price: 799 },
          addons: [{ name: 'Gas Top-Up', price: 299 }],
          address: { label: 'Home', city: 'Bengaluru', pincode: '560001' },
          pricing: { totalAmount: 1241.82, advanceAmount: 372.55 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  getSummary(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookingsService.getSummary(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update booking notes or scheduledAt (PENDING status only) — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking updated' })
  @ApiResponse({ status: 400, description: 'Cannot update a booking that is not PENDING' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a terminal booking (COMPLETED / CANCELLED / NO_SHOW only) — ADMIN' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete a non-terminal booking' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookingsService.remove(id, user.id);
  }

  // ─── Assignment ───────────────────────────────────────────────────────────

  @Post(':id/assign-manager')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Assign a manager and confirm booking: PENDING → CONFIRMED — ADMIN' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Manager assigned, status → CONFIRMED' })
  @ApiResponse({ status: 400, description: 'Booking is not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Booking or manager not found' })
  assignManager(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignManagerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingsService.assignManager(id, user.id, dto);
  }

  @Post(':id/assign-worker')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Assign a worker: CONFIRMED → ASSIGNED — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Worker assigned, status → ASSIGNED' })
  @ApiResponse({ status: 400, description: 'Booking is not in CONFIRMED status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Booking or worker not found' })
  assignWorker(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWorkerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingsService.assignWorker(id, user.id, dto);
  }

  // ─── Status transitions ───────────────────────────────────────────────────

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER, Role.WORKER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Cancel a booking — owner (USER), assigned WORKER (before accepting), MANAGER, or ADMIN' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking cancelled — customer notified via push' })
  @ApiResponse({ status: 400, description: 'Booking cannot be cancelled in its current status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — USER/WORKER can only cancel own bookings' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingsService.cancel(id, user.id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.WORKER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Complete a booking: ASSIGNED / IN_PROGRESS → COMPLETED — WORKER / MANAGER / ADMIN' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking completed — customer notified' })
  @ApiResponse({ status: 400, description: 'Booking is not in ASSIGNED or IN_PROGRESS status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookingsService.complete(id, user.id);
  }

  @Patch(':id/confirm')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Confirm without assigning a manager: PENDING → CONFIRMED — MANAGER / ADMIN' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking confirmed' })
  @ApiResponse({ status: 400, description: 'Booking is not in PENDING status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookingsService.confirm(id, user.id);
  }

  @Patch(':id/accept')
  @Roles(Role.WORKER)
  @ApiOperation({ summary: 'Accept an assigned job — WORKER (Worker Panel: Start Work step 1)' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Job accepted' })
  @ApiResponse({ status: 400, description: 'Job is not in ASSIGNED status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — not assigned to you' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookingsService.acceptByWorker(id, user.id);
  }

  @Patch(':id/start')
  @Roles(Role.WORKER)
  @ApiOperation({
    summary: 'Start a booking: CONFIRMED / ASSIGNED → IN_PROGRESS — WORKER',
    description: 'Optionally records the worker\'s GPS location at start time (Worker Panel: Start Work).',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking started' })
  @ApiResponse({ status: 400, description: 'Booking is not in CONFIRMED or ASSIGNED status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — WORKER role required' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartBookingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingsService.start(id, user.id, dto);
  }

  @Post(':id/photos')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.WORKER)
  @ApiOperation({
    summary: 'Attach a before/after job photo — WORKER (Worker Panel: Before Image / After Image)',
    description: 'imageUrl comes from POST /uploads/image — upload the photo there first, then reference the returned URL here.',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Photo saved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — not assigned to you' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  addPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddBookingPhotoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingsService.addPhoto(id, user.id, dto);
  }

  @Patch(':id/payment')
  @Roles(Role.WORKER)
  @ApiOperation({ summary: 'Record payment collected in person — WORKER (Worker Panel: Payment step)' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment recorded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — not assigned to you' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  collectPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingsService.collectPayment(id, user.id, dto);
  }

  @Patch(':id/no-show')
  @Roles(Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Mark booking as no-show: CONFIRMED → NO_SHOW — MANAGER / ADMIN' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking marked NO_SHOW' })
  @ApiResponse({ status: 400, description: 'Booking is not in CONFIRMED status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  markNoShow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookingsService.markNoShow(id, user.id);
  }

  @Patch(':id/reschedule')
  @Roles(Role.USER)
  @ApiOperation({ summary: 'Reschedule own booking: PENDING / CONFIRMED → RESCHEDULED — USER' })
  @ApiParam({ name: 'id', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Booking rescheduled — admin notified' })
  @ApiResponse({ status: 400, description: 'Booking is not in PENDING or CONFIRMED status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — USER can only reschedule own bookings' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleBookingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookingsService.reschedule(id, user.id, dto);
  }
}
