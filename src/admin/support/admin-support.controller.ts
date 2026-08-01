import {
  Body,
  Controller,
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
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { AdminSupportService } from './admin-support.service';
import { CreateAdminTicketDto } from './dto/create-admin-ticket.dto';
import { UpdateAdminTicketDto } from './dto/update-admin-ticket.dto';
import { QueryAdminSupportDto, QuerySupportCustomersDto } from './dto/query-admin-support.dto';

@ApiTags('Admin / Support')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly adminSupportService: AdminSupportService) {}

  // ─── Customer List ────────────────────────────────────────────────────────────

  @Get('customers')
  @ApiOperation({
    summary: 'List customers for support — ADMIN',
    description: 'Search and paginate all active customer accounts to select one for raising a ticket.',
  })
  @ApiOkResponse({
    description: 'Paginated customer list',
    schema: {
      example: {
        success: true,
        data: {
          items: [{ id: 'uuid', name: 'Rahul Sharma', email: 'rahul@gmail.com', mobile: '9876543210' }],
          meta: { total: 100, page: 1, limit: 20, totalPages: 5 },
        },
      },
    },
  })
  getCustomers(@Query() query: QuerySupportCustomersDto) {
    return this.adminSupportService.getCustomers(query);
  }

  // ─── Customer Bookings ────────────────────────────────────────────────────────

  @Get('customers/:customerId/bookings')
  @ApiOperation({
    summary: 'Get bookings for a customer — ADMIN',
    description: 'Returns all bookings for a specific customer, ordered by date desc. Used to select a booking when raising a BOOKING-type support ticket.',
  })
  @ApiParam({ name: 'customerId', description: 'Customer UUID' })
  @ApiOkResponse({
    description: 'Customer booking list',
    schema: {
      example: {
        success: true,
        data: [
          {
            id:            'uuid',
            bookingNumber: 'BK-2026-00124',
            serviceName:   'Electrician',
            bookingDate:   '2026-06-15T10:00:00.000Z',
            status:        'COMPLETED',
          },
        ],
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  getCustomerBookings(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.adminSupportService.getCustomerBookings(customerId);
  }

  // ─── Raise Ticket ─────────────────────────────────────────────────────────────

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Raise a support ticket — ADMIN',
    description:
      'Creates an admin-raised support ticket with a sequential ticket number (SUP-YYYY-NNNNNN). ' +
      'Sends a confirmation email to the customer and an alert email to the support admin. ' +
      'Email failures do not roll back ticket creation.',
  })
  @ApiBody({
    type: CreateAdminTicketDto,
    examples: {
      booking_issue: {
        summary: 'Booking issue',
        value: {
          customerId:  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          bookingId:   'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          issueType:   'BOOKING',
          customIssue: null,
          priority:    'HIGH',
          status:      'OPEN',
          subject:     'Payment Issue',
          description: 'Customer payment not reflected.',
        },
      },
      other_issue: {
        summary: 'Other issue',
        value: {
          customerId:  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          bookingId:   null,
          issueType:   'OTHER',
          customIssue: 'Wallet refund issue',
          priority:    'MEDIUM',
          status:      'OPEN',
          subject:     'Wallet',
          description: 'Refund not received.',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Ticket created',
    schema: {
      example: {
        success: true,
        message:  'Ticket created successfully',
        data: {
          id:           'uuid',
          ticketNumber: 'SUP-2026-000001',
          title:        'Payment Issue',
          subject:      'Payment Issue',
          description:  'Customer payment not reflected.',
          issueType:    'BOOKING',
          status:       'OPEN',
          priority:     'HIGH',
          createdAt:    '2026-06-21T10:00:00.000Z',
          customer:     { id: 'uuid', name: 'Rahul Sharma', email: 'rahul@gmail.com' },
          booking:      { id: 'uuid', bookingRef: 'BK-2026-00124' },
          createdBy:    { id: 'uuid', name: 'Admin User' },
        },
      },
    },
  })
  createTicket(@Body() dto: CreateAdminTicketDto, @CurrentUser() actor: AuthUser) {
    return this.adminSupportService.createTicket(dto, actor);
  }

  // ─── Ticket List ──────────────────────────────────────────────────────────────

  @Get('tickets')
  @ApiOperation({
    summary: 'List admin support tickets — ADMIN',
    description: 'Paginated list of admin-raised support tickets. Supports filtering by status, priority, customerId, and text search on ticket number or subject.',
  })
  @ApiOkResponse({
    description: 'Paginated ticket list',
    schema: {
      example: {
        success: true,
        data: {
          tickets: [
            {
              id:           'uuid',
              ticketNumber: 'SUP-2026-000001',
              subject:      'Payment Issue',
              status:       'OPEN',
              priority:     'HIGH',
              issueType:    'BOOKING',
              createdAt:    '2026-06-21T10:00:00.000Z',
              customer:     { id: 'uuid', name: 'Rahul Sharma', email: 'rahul@gmail.com', phone: '9876543210' },
              booking:      { id: 'uuid', bookingRef: 'BK-2026-00124' },
              createdBy:    { id: 'uuid', name: 'Admin User' },
            },
          ],
          meta: { total: 45, page: 1, limit: 20, totalPages: 3 },
        },
      },
    },
  })
  listTickets(@Query() query: QueryAdminSupportDto) {
    return this.adminSupportService.listTickets(query);
  }

  // ─── Ticket Detail ────────────────────────────────────────────────────────────

  @Get('tickets/:id')
  @ApiOperation({
    summary: 'Support ticket detail — ADMIN',
    description: 'Full ticket detail including customer, booking, subject, description, priority, status, internal notes, timeline (comments), created by, and timestamps.',
  })
  @ApiParam({ name: 'id', description: 'Ticket UUID' })
  @ApiOkResponse({
    description: 'Ticket detail',
    schema: {
      example: {
        success: true,
        data: {
          id:           'uuid',
          ticketNumber: 'SUP-2026-000001',
          subject:      'Payment Issue',
          description:  'Customer payment not reflected.',
          issueType:    'BOOKING',
          customIssue:  null,
          status:       'OPEN',
          priority:     'HIGH',
          internalNotes: 'Escalated to billing team.',
          resolutionNote: null,
          resolvedAt:   null,
          closedAt:     null,
          createdAt:    '2026-06-21T10:00:00.000Z',
          updatedAt:    '2026-06-21T10:00:00.000Z',
          customer:     { id: 'uuid', name: 'Rahul Sharma', email: 'rahul@gmail.com', phone: '9876543210' },
          booking:      { id: 'uuid', bookingRef: 'BK-2026-00124', status: 'COMPLETED', scheduledAt: '2026-06-15T10:00:00.000Z', service: { name: 'Electrician' } },
          createdBy:    { id: 'uuid', name: 'Admin User', role: 'ADMIN' },
          assignedTo:   null,
          comments: [],
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  getTicket(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminSupportService.getTicket(id);
  }

  // ─── Update Ticket ────────────────────────────────────────────────────────────

  @Patch('tickets/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update support ticket — ADMIN',
    description: 'Update ticket status, priority, and/or internal admin notes. Closing a ticket sets the closedAt timestamp automatically.',
  })
  @ApiParam({ name: 'id', description: 'Ticket UUID' })
  @ApiBody({
    type: UpdateAdminTicketDto,
    examples: {
      close: {
        summary: 'Close ticket',
        value: { status: 'CLOSED', internalNotes: 'Resolved after verifying payment receipt.' },
      },
      escalate: {
        summary: 'Escalate priority',
        value: { priority: 'URGENT' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Ticket updated',
    schema: {
      example: {
        success: true,
        message:  'Ticket updated successfully',
        data: { id: 'uuid', ticketNumber: 'SUP-2026-000001', status: 'CLOSED', closedAt: '2026-06-21T11:00:00.000Z' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  updateTicket(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminTicketDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.adminSupportService.updateTicket(id, dto, actor);
  }
}
