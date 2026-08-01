import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, ActivityModule, IssueType, Prisma, Role, TicketStatus } from '@prisma/client';

import { ActivityLogService } from '../../activity-log/activity-log.service';
import { AuthUser } from '../../common/types/auth-user.type';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdminTicketDto } from './dto/create-admin-ticket.dto';
import { UpdateAdminTicketDto } from './dto/update-admin-ticket.dto';
import { QueryAdminSupportDto, QuerySupportCustomersDto } from './dto/query-admin-support.dto';

const ADMIN_ALERT_EMAIL = 'sahil84330@gmail.com';

const TICKET_LIST_SELECT = {
  id: true,
  ticketNumber: true,
  subject: true,
  status: true,
  priority: true,
  issueType: true,
  createdAt: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  booking: { select: { id: true, bookingRef: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.SupportTicketSelect;

const TICKET_DETAIL_SELECT = {
  id: true,
  ticketNumber: true,
  subject: true,
  description: true,
  issueType: true,
  customIssue: true,
  status: true,
  priority: true,
  internalNotes: true,
  resolutionNote: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  booking: { select: { id: true, bookingRef: true, status: true, scheduledAt: true, service: { select: { name: true } } } },
  createdBy: { select: { id: true, name: true, role: true } },
  assignedTo: { select: { id: true, name: true, role: true } },
  comments: {
    select: {
      id: true,
      body: true,
      isInternal: true,
      createdAt: true,
      author: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SupportTicketSelect;

@Injectable()
export class AdminSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly email: EmailService,
  ) {}

  // ─── Customer List ────────────────────────────────────────────────────────────

  async getCustomers(query: QuerySupportCustomersDto) {
    const { page = 1, limit = 20, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = { role: Role.USER, isActive: true };
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, phone: true },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: {
        items: users.map((u) => ({ id: u.id, name: u.name, email: u.email, mobile: u.phone })),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  // ─── Customer Bookings ────────────────────────────────────────────────────────

  async getCustomerBookings(customerId: string) {
    const customer = await this.prisma.user.findFirst({
      where: { id: customerId, role: Role.USER },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const bookings = await this.prisma.booking.findMany({
      where: { customerId },
      select: {
        id:          true,
        bookingRef:  true,
        status:      true,
        scheduledAt: true,
        service:     { select: { name: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    return {
      success: true,
      data: bookings.map((b) => ({
        id:            b.id,
        bookingNumber: b.bookingRef ?? b.id,
        serviceName:   b.service.name,
        bookingDate:   b.scheduledAt,
        status:        b.status,
      })),
    };
  }

  // ─── Raise Ticket ─────────────────────────────────────────────────────────────

  async createTicket(dto: CreateAdminTicketDto, actor: AuthUser) {
    // Cross-field validation
    if (dto.issueType === IssueType.BOOKING && !dto.bookingId) {
      throw new BadRequestException('bookingId is required when issueType is BOOKING');
    }
    if (dto.issueType === IssueType.OTHER && !dto.customIssue?.trim()) {
      throw new BadRequestException('customIssue is required when issueType is OTHER');
    }

    // Verify customer
    const customer = await this.prisma.user.findFirst({
      where: { id: dto.customerId, role: Role.USER },
      select: { id: true, name: true, email: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // Verify booking if provided
    let booking: { id: string; bookingRef: string | null } | null = null;
    if (dto.bookingId) {
      booking = await this.prisma.booking.findFirst({
        where: { id: dto.bookingId, customerId: dto.customerId },
        select: { id: true, bookingRef: true },
      });
      if (!booking) throw new NotFoundException('Booking not found for this customer');
    }

    // Generate ticket number and create in one atomic transaction
    const year = new Date().getFullYear();
    let ticketNumber: string;
    let ticket: Awaited<ReturnType<typeof this.prisma.supportTicket.create>>;

    ({ ticketNumber, ticket } = await this.prisma.$transaction(async (tx) => {
      const counter = await tx.supportTicketCounter.upsert({
        where:  { year },
        create: { year, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      const tn = `SUP-${year}-${String(counter.seq).padStart(6, '0')}`;

      const created = await tx.supportTicket.create({
        data: {
          ticketNumber:  tn,
          title:         dto.subject,
          subject:       dto.subject,
          description:   dto.description,
          issueType:     dto.issueType,
          customIssue:   dto.customIssue ?? null,
          priority:      dto.priority,
          status:        dto.status,
          createdById:   actor.id,
          customerId:    dto.customerId,
          bookingId:     dto.bookingId ?? null,
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          booking:  { select: { id: true, bookingRef: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });

      return { ticketNumber: tn, ticket: created };
    }));

    // Fire-and-forget: email to customer
    this.email
      .sendSupportTicketCreatedToCustomer({
        to:           customer.email,
        customerName: customer.name,
        ticketNumber,
        subject:      dto.subject,
        priority:     dto.priority,
        status:       dto.status,
      })
      .catch(() => {});

    // Fire-and-forget: email to admin
    this.email
      .sendNewSupportTicketAlertToAdmin({
        ticketNumber,
        customerName:  customer.name,
        customerEmail: customer.email,
        bookingRef:    booking?.bookingRef ?? null,
        subject:       dto.subject,
        description:   dto.description,
        priority:      dto.priority,
        status:        dto.status,
      })
      .catch(() => {});

    // Activity log
    this.activityLog.log({
      action:      ActivityAction.SUPPORT_TICKET_CREATED,
      module:      ActivityModule.SUPPORT,
      description: `Support ticket ${ticketNumber} raised for customer ${customer.name}`,
      actor:       { id: actor.id, name: actor.name, role: actor.role },
      target:      { id: ticket.id, type: 'SupportTicket' },
      metadata: {
        ticketNumber,
        customerId:  dto.customerId,
        bookingId:   dto.bookingId ?? null,
        issueType:   dto.issueType,
        priority:    dto.priority,
        status:      dto.status,
      },
    });

    return { success: true, message: 'Ticket created successfully', data: ticket };
  }

  // ─── Ticket List ──────────────────────────────────────────────────────────────

  async listTickets(query: QueryAdminSupportDto) {
    const { page = 1, limit = 20, status, priority, customerId, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SupportTicketWhereInput = {
      ticketNumber: { not: null }, // only admin-created tickets
    };
    if (status)     where.status     = status;
    if (priority)   where.priority   = priority;
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { ticketNumber: { contains: search, mode: 'insensitive' } },
        { subject:      { contains: search, mode: 'insensitive' } },
      ];
    }

    const [tickets, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        select: TICKET_LIST_SELECT,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      success: true,
      data: {
        tickets,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  // ─── Ticket Detail ────────────────────────────────────────────────────────────

  async getTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where:  { id },
      select: TICKET_DETAIL_SELECT,
    });
    if (!ticket || !ticket.ticketNumber) throw new NotFoundException('Ticket not found');

    return { success: true, data: ticket };
  }

  // ─── Update Ticket ────────────────────────────────────────────────────────────

  async updateTicket(id: string, dto: UpdateAdminTicketDto, actor: AuthUser) {
    const existing = await this.prisma.supportTicket.findUnique({
      where:  { id },
      select: { id: true, ticketNumber: true, status: true, subject: true },
    });
    if (!existing || !existing.ticketNumber) throw new NotFoundException('Ticket not found');

    const isClosing = dto.status === TicketStatus.CLOSED && existing.status !== TicketStatus.CLOSED;

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.status        !== undefined && { status: dto.status, ...(isClosing && { closedAt: new Date() }) }),
        ...(dto.priority      !== undefined && { priority: dto.priority }),
        ...(dto.internalNotes !== undefined && { internalNotes: dto.internalNotes }),
      },
      select: TICKET_DETAIL_SELECT,
    });

    const action = isClosing
      ? ActivityAction.SUPPORT_TICKET_CLOSED
      : ActivityAction.SUPPORT_TICKET_UPDATED;

    this.activityLog.log({
      action,
      module:      ActivityModule.SUPPORT,
      description: `Support ticket ${existing.ticketNumber} ${isClosing ? 'closed' : 'updated'}`,
      actor:       { id: actor.id, name: actor.name, role: actor.role },
      target:      { id, type: 'SupportTicket' },
      metadata: {
        ticketNumber: existing.ticketNumber,
        changes:      dto,
      },
    });

    return { success: true, message: 'Ticket updated successfully', data: updated };
  }
}
