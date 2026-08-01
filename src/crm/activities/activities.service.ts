import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

const ACTIVITY_SELECT = {
  id: true,
  type: true,
  title: true,
  description: true,
  outcome: true,
  scheduledAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  performedBy: { select: { id: true, name: true, email: true } },
  customer:    { select: { id: true, name: true, company: true } },
  lead:        { select: { id: true, title: true, status: true } },
  deal:        { select: { id: true, title: true, stage: true } },
  contact:     { select: { id: true, name: true, email: true } },
} satisfies Prisma.ActivitySelect;

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateActivityDto, actorId: string, orgId?: string) {
    if (dto.customerId) await this.assertCustomerExists(dto.customerId);
    if (dto.leadId)     await this.assertLeadExists(dto.leadId);
    if (dto.dealId)     await this.assertDealExists(dto.dealId);
    if (dto.contactId)  await this.assertContactExists(dto.contactId);

    const activity = await this.prisma.activity.create({
      data: {
        type:          dto.type,
        title:         dto.title,
        description:   dto.description,
        outcome:       dto.outcome,
        scheduledAt:   dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        completedAt:   dto.completedAt ? new Date(dto.completedAt) : undefined,
        performedById: actorId,
        organizationId: orgId ?? null,
        customerId:    dto.customerId,
        leadId:        dto.leadId,
        dealId:        dto.dealId,
        contactId:     dto.contactId,
      },
      select: ACTIVITY_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Activity', entityId: activity.id, action: AuditAction.CREATE, newValue: { type: dto.type, title: dto.title } })
      .catch(() => {});

    return { success: true, message: 'Activity logged successfully', data: activity };
  }

  async findAll(query: ActivityQueryDto, orgId?: string) {
    const { page = 1, limit = 20, type, customerId, leadId, dealId, contactId, search } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.ActivityWhereInput = {};

    if (orgId)      where.organizationId = orgId;
    if (type)       where.type = type;
    if (customerId) where.customerId = customerId;
    if (leadId)     where.leadId = leadId;
    if (dealId)     where.dealId = dealId;
    if (contactId)  where.contactId = contactId;
    if (search) {
      where.OR = [
        { title:       { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [activities, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({
        where,
        select: ACTIVITY_SELECT,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.activity.count({ where }),
    ]);

    return {
      success: true,
      data: { activities, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const activity = await this.prisma.activity.findUnique({ where: { id }, select: ACTIVITY_SELECT });
    if (!activity) throw new NotFoundException('Activity not found');
    return { success: true, data: activity };
  }

  async update(id: string, dto: UpdateActivityDto, actorId: string) {
    const existing = await this.prisma.activity.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Activity not found');

    if (dto.customerId) await this.assertCustomerExists(dto.customerId);
    if (dto.leadId)     await this.assertLeadExists(dto.leadId);
    if (dto.dealId)     await this.assertDealExists(dto.dealId);
    if (dto.contactId)  await this.assertContactExists(dto.contactId);

    const activity = await this.prisma.activity.update({
      where: { id },
      data: {
        ...(dto.type        !== undefined && { type:        dto.type }),
        ...(dto.title       !== undefined && { title:       dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.outcome     !== undefined && { outcome:     dto.outcome }),
        ...(dto.scheduledAt !== undefined && { scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null }),
        ...(dto.completedAt !== undefined && { completedAt: dto.completedAt ? new Date(dto.completedAt) : null }),
        ...(dto.customerId  !== undefined && { customerId:  dto.customerId }),
        ...(dto.leadId      !== undefined && { leadId:      dto.leadId }),
        ...(dto.dealId      !== undefined && { dealId:      dto.dealId }),
        ...(dto.contactId   !== undefined && { contactId:   dto.contactId }),
      },
      select: ACTIVITY_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Activity', entityId: id, action: AuditAction.UPDATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Activity updated successfully', data: activity };
  }

  async remove(id: string, actorId: string) {
    const existing = await this.prisma.activity.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Activity not found');

    await this.prisma.activity.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'Activity', entityId: id, action: AuditAction.DELETE })
      .catch(() => {});

    return { success: true, message: 'Activity deleted successfully' };
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private async assertCustomerExists(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException(`Customer with ID ${id} not found`);
  }

  private async assertLeadExists(id: string) {
    const l = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!l) throw new NotFoundException(`Lead with ID ${id} not found`);
  }

  private async assertDealExists(id: string) {
    const d = await this.prisma.deal.findUnique({ where: { id }, select: { id: true } });
    if (!d) throw new NotFoundException(`Deal with ID ${id} not found`);
  }

  private async assertContactExists(id: string) {
    const c = await this.prisma.contact.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException(`Contact with ID ${id} not found`);
  }
}
