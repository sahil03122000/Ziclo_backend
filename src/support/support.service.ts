import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityAction,
  ActivityModule,
  AuditAction,
  Prisma,
  Role,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

import { ActivityLogService } from '../activity-log/activity-log.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { EscalateTicketDto } from './dto/escalate-ticket.dto';
import { ResolveTicketDto } from './dto/resolve-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  profileImage: true,
} satisfies Prisma.UserSelect;

const TICKET_INCLUDE = {
  createdBy: { select: USER_SELECT },
  assignedTo: { select: USER_SELECT },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.SupportTicketInclude;

const TICKET_DETAIL_INCLUDE = {
  createdBy: { select: USER_SELECT },
  assignedTo: { select: USER_SELECT },
  comments: {
    include: { author: { select: USER_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
  attachments: {
    include: { uploadedBy: { select: USER_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
  escalations: {
    include: { escalatedBy: { select: USER_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SupportTicketInclude;

const PRIORITY_RANK: Record<TicketPriority, number> = {
  [TicketPriority.LOW]: 0,
  [TicketPriority.MEDIUM]: 1,
  [TicketPriority.HIGH]: 2,
  [TicketPriority.CRITICAL]: 3,
  [TicketPriority.URGENT]: 4,
};

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async create(dto: CreateTicketDto, user: AuthUser, orgId?: string) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? TicketPriority.MEDIUM,
        createdById: user.id,
        organizationId: orgId ?? null,
      },
      include: TICKET_INCLUDE,
    });

    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'SupportTicket',
        entityId: ticket.id,
        action: AuditAction.CREATE,
        newValue: { title: ticket.title, priority: ticket.priority },
      })
      .catch(() => {});

    this.notifyAdmins(
      orgId,
      'New Support Ticket',
      `New ticket opened: "${ticket.title}"`,
      { ticketId: ticket.id },
    ).catch(() => {});

    this.activityLog.log({
      action: ActivityAction.COMPLAINT_CREATED,
      module: ActivityModule.SUPPORT,
      description: `Support ticket "${ticket.title}" created`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id: ticket.id, type: 'SupportTicket' },
      metadata: { priority: ticket.priority },
    });

    return {
      success: true,
      message: 'Ticket created successfully',
      data: ticket,
    };
  }

  async findAll(query: TicketQueryDto, user: AuthUser, orgId?: string) {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      assignedToId,
      createdById,
      search,
    } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.SupportTicketWhereInput = {};

    if (orgId) where.organizationId = orgId;

    const isLimitedRole = user.role === Role.USER || user.role === Role.WORKER;
    if (isLimitedRole) {
      where.createdById = user.id;
    } else {
      if (createdById) where.createdById = createdById;
      // MANAGER sees only tickets tied to a booking they own directly or whose worker
      // belongs to their own team — never another manager's tickets. ADMIN/SUPER_ADMIN/
      // ORGANIZATION_ADMIN are unaffected (no scope narrowing).
      if (user.role === Role.MANAGER) {
        where.booking = await this.resolveManagerBookingWhere(user.id);
      }
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [tickets, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        include: TICKET_INCLUDE,
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

  async findOne(id: string, user: AuthUser) {
    const isLimitedRole = user.role === Role.USER || user.role === Role.WORKER;

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: TICKET_DETAIL_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (isLimitedRole && ticket.createdById !== user.id) {
      throw new ForbiddenException('Access denied');
    }

    if (
      user.role === Role.MANAGER &&
      !(await this.isTicketInManagerScope(ticket, user.id))
    ) {
      throw new ForbiddenException('Access denied');
    }

    if (isLimitedRole) {
      return {
        success: true,
        data: {
          ...ticket,
          comments: ticket.comments.filter((c) => !c.isInternal),
          escalations: [],
        },
      };
    }

    return { success: true, data: ticket };
  }

  async update(id: string, dto: UpdateTicketDto, user: AuthUser) {
    const ticket = await this.requireTicket(id);

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Cannot update a closed ticket');
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
      },
      include: TICKET_INCLUDE,
    });

    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'SupportTicket',
        entityId: id,
        action: AuditAction.UPDATE,
        oldValue: {
          title: ticket.title,
          description: ticket.description,
          priority: ticket.priority,
        },
        newValue: dto as Record<string, unknown>,
      })
      .catch(() => {});

    return { success: true, message: 'Ticket updated', data: updated };
  }

  async addComment(id: string, dto: AddCommentDto, user: AuthUser) {
    const ticket = await this.requireTicket(id);
    const isLimitedRole = user.role === Role.USER || user.role === Role.WORKER;

    if (isLimitedRole && ticket.createdById !== user.id) {
      throw new ForbiddenException('Access denied');
    }

    if (dto.isInternal && isLimitedRole) {
      throw new ForbiddenException('Only staff can post internal notes');
    }

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Cannot comment on a closed ticket');
    }

    const comment = await this.prisma.ticketComment.create({
      data: {
        ticketId: id,
        authorId: user.id,
        body: dto.body,
        isInternal: dto.isInternal ?? false,
      },
      include: { author: { select: USER_SELECT } },
    });

    if (!dto.isInternal) {
      if (ticket.createdById !== user.id) {
        this.notifications
          .notify(
            ticket.createdById,
            'New Comment on Your Ticket',
            `"${ticket.title}" has a new update`,
            { ticketId: id },
          )
          .catch(() => {});
      }
      if (ticket.assignedToId && ticket.assignedToId !== user.id) {
        this.notifications
          .notify(
            ticket.assignedToId,
            'New Comment on Ticket',
            `"${ticket.title}" has a new update`,
            { ticketId: id },
          )
          .catch(() => {});
      }
    }

    return { success: true, message: 'Comment added', data: comment };
  }

  async addAttachment(id: string, dto: AddAttachmentDto, user: AuthUser) {
    const ticket = await this.requireTicket(id);
    const isLimitedRole = user.role === Role.USER || user.role === Role.WORKER;

    if (isLimitedRole && ticket.createdById !== user.id) {
      throw new ForbiddenException('Access denied');
    }

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Cannot attach files to a closed ticket');
    }

    const attachment = await this.prisma.ticketAttachment.create({
      data: {
        ticketId: id,
        uploadedById: user.id,
        fileName: dto.fileName,
        fileUrl: dto.fileUrl,
        fileSize: dto.fileSize,
        mimeType: dto.mimeType,
      },
      include: { uploadedBy: { select: USER_SELECT } },
    });

    return { success: true, message: 'Attachment added', data: attachment };
  }

  async assign(id: string, dto: AssignTicketDto, user: AuthUser) {
    const ticket = await this.requireTicket(id);

    if (
      ticket.status === TicketStatus.CLOSED ||
      ticket.status === TicketStatus.RESOLVED
    ) {
      throw new BadRequestException(
        'Cannot assign a resolved or closed ticket',
      );
    }

    const assignee = await this.prisma.user.findUnique({
      where: { id: dto.assignedToId },
      select: { id: true, isActive: true },
    });
    if (!assignee) throw new NotFoundException('Assignee not found');
    if (!assignee.isActive)
      throw new BadRequestException('Assignee account is inactive');

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        assignedToId: dto.assignedToId,
        status: TicketStatus.IN_PROGRESS,
      },
      include: TICKET_INCLUDE,
    });

    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'SupportTicket',
        entityId: id,
        action: AuditAction.ASSIGN,
        oldValue: { assignedToId: ticket.assignedToId },
        newValue: { assignedToId: dto.assignedToId },
      })
      .catch(() => {});

    this.notifications
      .notify(
        dto.assignedToId,
        'Ticket Assigned to You',
        `"${ticket.title}" has been assigned to you`,
        { ticketId: id },
      )
      .catch(() => {});

    if (ticket.createdById !== dto.assignedToId) {
      this.notifications
        .notify(
          ticket.createdById,
          'Your Ticket is Being Handled',
          `"${ticket.title}" is now in progress`,
          { ticketId: id },
        )
        .catch(() => {});
    }

    return {
      success: true,
      message: 'Ticket assigned and set to IN_PROGRESS',
      data: updated,
    };
  }

  async escalate(id: string, dto: EscalateTicketDto, user: AuthUser) {
    const ticket = await this.requireTicket(id);

    if (
      ticket.status === TicketStatus.CLOSED ||
      ticket.status === TicketStatus.RESOLVED
    ) {
      throw new BadRequestException(
        'Cannot escalate a resolved or closed ticket',
      );
    }

    if (PRIORITY_RANK[dto.newPriority] <= PRIORITY_RANK[ticket.priority]) {
      throw new BadRequestException(
        `New priority must be higher than current priority (${ticket.priority})`,
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.supportTicket.update({
        where: { id },
        data: { priority: dto.newPriority },
        include: TICKET_INCLUDE,
      }),
      this.prisma.ticketEscalation.create({
        data: {
          ticketId: id,
          escalatedById: user.id,
          reason: dto.reason,
          previousPriority: ticket.priority,
          newPriority: dto.newPriority,
        },
      }),
    ]);

    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'SupportTicket',
        entityId: id,
        action: AuditAction.STATUS_CHANGE,
        oldValue: { priority: ticket.priority },
        newValue: { priority: dto.newPriority, reason: dto.reason },
      })
      .catch(() => {});

    this.notifications
      .notify(
        ticket.createdById,
        'Ticket Escalated',
        `"${ticket.title}" escalated to ${dto.newPriority} priority`,
        { ticketId: id },
      )
      .catch(() => {});

    if (ticket.assignedToId) {
      this.notifications
        .notify(
          ticket.assignedToId,
          'Ticket Escalated',
          `"${ticket.title}" escalated to ${dto.newPriority} priority`,
          { ticketId: id },
        )
        .catch(() => {});
    }

    return { success: true, message: 'Ticket escalated', data: updated };
  }

  async resolve(id: string, dto: ResolveTicketDto, user: AuthUser) {
    const ticket = await this.requireTicket(id);

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Ticket is already closed');
    }
    if (ticket.status === TicketStatus.RESOLVED) {
      throw new BadRequestException('Ticket is already resolved');
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: TicketStatus.RESOLVED,
        resolvedAt: new Date(),
        ...(dto.resolutionNote !== undefined && {
          resolutionNote: dto.resolutionNote,
        }),
      },
      include: TICKET_INCLUDE,
    });

    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'SupportTicket',
        entityId: id,
        action: AuditAction.STATUS_CHANGE,
        oldValue: { status: ticket.status },
        newValue: { status: TicketStatus.RESOLVED },
      })
      .catch(() => {});

    this.notifications
      .notify(
        ticket.createdById,
        'Your Ticket Has Been Resolved',
        `"${ticket.title}" has been resolved`,
        { ticketId: id },
      )
      .catch(() => {});

    this.activityLog.log({
      action: ActivityAction.COMPLAINT_RESOLVED,
      module: ActivityModule.SUPPORT,
      description: `Support ticket "${ticket.title}" resolved`,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { id, type: 'SupportTicket' },
      metadata: { resolutionNote: dto.resolutionNote },
    });

    return { success: true, message: 'Ticket resolved', data: updated };
  }

  async close(id: string, user: AuthUser) {
    const ticket = await this.requireTicket(id);

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Ticket is already closed');
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: { status: TicketStatus.CLOSED, closedAt: new Date() },
      include: TICKET_INCLUDE,
    });

    this.auditLogs
      .log({
        actorId: user.id,
        entityType: 'SupportTicket',
        entityId: id,
        action: AuditAction.STATUS_CHANGE,
        oldValue: { status: ticket.status },
        newValue: { status: TicketStatus.CLOSED },
      })
      .catch(() => {});

    this.notifications
      .notify(
        ticket.createdById,
        'Your Ticket Has Been Closed',
        `"${ticket.title}" has been closed`,
        { ticketId: id },
      )
      .catch(() => {});

    return { success: true, message: 'Ticket closed', data: updated };
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  // A ticket "belongs" to a manager only via its Booking (SupportTicket has no direct
  // office/area/worker/manager column) — either the booking is assigned to this manager
  // directly, or it was performed by one of their own workers. Mirrors the pincode-over-area
  // precedence of ManagerService.resolveWorkerFilter; duplicated as a small direct-Prisma
  // query here (not a call into ManagerService) since ManagerModule already depends on
  // SupportModule — the reverse import would be circular.
  private async resolveManagerBookingWhere(
    managerUserId: string,
  ): Promise<Prisma.BookingWhereInput> {
    const profile = await this.prisma.managerProfile.findUnique({
      where: { userId: managerUserId },
      select: {
        pincodes: { select: { pincodeId: true } },
        areas: { select: { areaId: true } },
      },
    });
    const pincodeIds = profile?.pincodes.map((p) => p.pincodeId) ?? [];
    const areaIds = profile?.areas.map((a) => a.areaId) ?? [];
    const workerProfileFilter: Prisma.WorkerProfileWhereInput =
      pincodeIds.length > 0
        ? { pincodeId: { in: pincodeIds } }
        : { areaId: { in: areaIds } };

    return {
      OR: [
        { managerId: managerUserId },
        { worker: { workerProfile: workerProfileFilter } },
      ],
    };
  }

  // Tickets with no bookingId have no manager-derivable owner under the current schema —
  // excluded rather than shown to any manager (fails closed).
  private async isTicketInManagerScope(
    ticket: { bookingId: string | null },
    managerUserId: string,
  ): Promise<boolean> {
    if (!ticket.bookingId) return false;
    const bookingWhere = await this.resolveManagerBookingWhere(managerUserId);
    const match = await this.prisma.booking.findFirst({
      where: { id: ticket.bookingId, ...bookingWhere },
      select: { id: true },
    });
    return !!match;
  }

  private async requireTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  private async notifyAdmins(
    orgId: string | undefined,
    title: string,
    message: string,
    data: Record<string, string>,
  ) {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.SUPER_ADMIN] },
        isActive: true,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      select: { id: true },
    });
    await Promise.allSettled(
      admins.map((a) => this.notifications.notify(a.id, title, message, data)),
    );
  }
}
