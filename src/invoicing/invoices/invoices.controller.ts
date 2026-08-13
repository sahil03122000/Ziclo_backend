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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { AddInvoiceItemDto } from './dto/add-invoice-item.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceQueryDto } from './dto/invoice-query.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { UpdatePdfMetadataDto } from './dto/update-pdf-metadata.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Invoicing / Invoices')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Controller('invoicing/invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  // ─── Customer self-service ────────────────────────────────────────────────

  @Get('my')
  @Roles(Role.USER)
  @ApiOperation({ summary: "Customer's own invoice history — USER" })
  @ApiResponse({ status: 200, description: 'Paginated invoice list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — USER role required' })
  findMy(@CurrentUser() user: AuthUser, @Query() query: InvoiceQueryDto) {
    return this.invoicesService.findMy(user.id, query);
  }

  // ─── Admin / Manager ──────────────────────────────────────────────────────

  @Get('stats')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Invoice stats: total billed, paid, outstanding, overdue — ADMIN / MANAGER' })
  @ApiResponse({
    status: 200,
    description: 'Invoice statistics',
    schema: {
      example: {
        success: true,
        data: { totalBilled: 250000, totalPaid: 180000, outstanding: 70000, overdue: 15000, invoiceCount: 124, overdueCount: 8 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getStats() {
    return this.invoicesService.getStats();
  }

  @Post('from-booking/:bookingId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Auto-generate invoice from a COMPLETED booking — ADMIN / MANAGER',
    description: 'Creates a DRAFT invoice pre-filled with the booking\'s service, package, add-ons, and total amount.',
  })
  @ApiParam({ name: 'bookingId', description: 'Booking UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Invoice generated with status DRAFT' })
  @ApiResponse({ status: 400, description: 'Booking is not in COMPLETED status or invoice already exists' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  generateFromBooking(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoicesService.generateFromBooking(bookingId, user.id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a manual invoice — ADMIN / MANAGER' })
  @ApiResponse({ status: 201, description: 'Invoice created with status DRAFT' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.invoicesService.create(dto, user.id);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List all invoices with filters — ADMIN / MANAGER' })
  @ApiResponse({ status: 200, description: 'Paginated invoice list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findAll(@Query() query: InvoiceQueryDto) {
    return this.invoicesService.findAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.USER)
  @ApiOperation({ summary: 'Get invoice detail by ID — USER can only view own invoices' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice detail with line items' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — USER can only view own invoices' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update a DRAFT or SENT invoice — GST rate, discount, notes, due date — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice updated' })
  @ApiResponse({ status: 400, description: 'Cannot update a PAID, OVERDUE, or CANCELLED invoice' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoicesService.update(id, dto, user.id);
  }

  @Post(':id/items')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Add a line item to a DRAFT or SENT invoice' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Line item added — totals recalculated' })
  @ApiResponse({ status: 400, description: 'Invoice is not DRAFT or SENT' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddInvoiceItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoicesService.addItem(id, dto, user.id);
  }

  @Delete(':id/items/:itemId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Remove a line item — minimum 1 item must remain' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiParam({ name: 'itemId', description: 'Invoice item UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Line item removed — totals recalculated' })
  @ApiResponse({ status: 400, description: 'Cannot remove the last item' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Invoice or item not found' })
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoicesService.removeItem(id, itemId, user.id);
  }

  @Patch(':id/send')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Send invoice to customer: DRAFT → SENT — ADMIN / MANAGER. Customer receives push notification.' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice sent — customer notified' })
  @ApiResponse({ status: 400, description: 'Invoice is not in DRAFT status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.send(id, user.id);
  }

  @Patch(':id/overdue')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Mark invoice as OVERDUE: SENT → OVERDUE — ADMIN / MANAGER' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice marked OVERDUE' })
  @ApiResponse({ status: 400, description: 'Invoice is not in SENT status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  markOverdue(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.markOverdue(id, user.id);
  }

  @Patch(':id/pdf')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Store PDF URL and generation timestamp (call after external PDF generation)' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'PDF metadata stored' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  updatePdfMetadata(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePdfMetadataDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invoicesService.updatePdfMetadata(id, dto, user.id);
  }

  @Patch(':id/mark-paid')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Manually mark an invoice PAID and create a payment record — ADMIN' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice marked PAID — payment record created' })
  @ApiResponse({ status: 400, description: 'Invoice is already PAID or CANCELLED' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  markPaid(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.markPaid(id, user.id);
  }

  @Get(':id/pdf')
  @Roles(Role.ADMIN, Role.MANAGER, Role.USER)
  @ApiOperation({ summary: 'Return the PDF URL for an invoice — generates it on first request if missing' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'PDF URL', schema: { example: { success: true, data: { pdfUrl: 'https://...', generatedAt: '2026-06-21T10:00:00Z' } } } })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  getPdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.getPdf(id, user);
  }

  @Patch(':id/cancel')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cancel an unpaid invoice — ADMIN' })
  @ApiParam({ name: 'id', description: 'Invoice UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice cancelled' })
  @ApiResponse({ status: 400, description: 'Cannot cancel a PAID invoice' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — ADMIN required' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.invoicesService.cancel(id, user.id);
  }
}
