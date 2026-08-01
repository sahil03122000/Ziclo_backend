import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { DealQueryDto } from './dto/deal-query.dto';
import { UpdateDealDto } from './dto/update-deal.dto';

const DEAL_SELECT = {
  id:             true,
  title:          true,
  value:          true,
  stage:          true,
  notes:          true,
  closedAt:       true,
  organizationId: true,
  createdAt:      true,
  updatedAt:      true,
  customer:   { select: { id: true, name: true, company: true } },
  contact:    { select: { id: true, name: true, email: true } },
  lead:       { select: { id: true, title: true, status: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  createdBy:  { select: { id: true, name: true, email: true } },
} satisfies Prisma.DealSelect;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateDealDto, actorId: string, orgId?: string) {
    await this.assertCustomerExists(dto.customerId);
    if (dto.contactId) await this.assertContactExists(dto.contactId);
    if (dto.leadId)    await this.assertLeadExists(dto.leadId);

    const deal = await this.prisma.deal.create({
      data: {
        title:          dto.title,
        value:          dto.value,
        stage:          dto.stage,
        customerId:     dto.customerId,
        contactId:      dto.contactId,
        leadId:         dto.leadId,
        notes:          dto.notes,
        assignedToId:   dto.assignedToId,
        closedAt:       dto.closedAt,
        createdById:    actorId,
        organizationId: orgId ?? null,
      },
      select: DEAL_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Deal', entityId: deal.id, action: AuditAction.CREATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Deal created successfully', data: deal };
  }

  async findAll(query: DealQueryDto, orgId?: string) {
    const { page = 1, limit = 20, search, stage, customerId, leadId, assignedToId } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.DealWhereInput = {};

    if (orgId)       where.organizationId = orgId;
    if (stage)       where.stage = stage;
    if (customerId)  where.customerId = customerId;
    if (leadId)      where.leadId = leadId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [deals, total] = await this.prisma.$transaction([
      this.prisma.deal.findMany({ where, select: DEAL_SELECT, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.deal.count({ where }),
    ]);

    return {
      success: true,
      data: { deals, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, select: DEAL_SELECT });
    if (!deal) throw new NotFoundException('Deal not found');
    return { success: true, data: deal };
  }

  async update(id: string, dto: UpdateDealDto, actorId: string) {
    const existing = await this.assertExists(id);
    if (dto.customerId) await this.assertCustomerExists(dto.customerId);
    if (dto.contactId)  await this.assertContactExists(dto.contactId);
    if (dto.leadId)     await this.assertLeadExists(dto.leadId);

    const deal = await this.prisma.deal.update({
      where: { id },
      data: {
        ...(dto.title        !== undefined && { title:        dto.title }),
        ...(dto.value        !== undefined && { value:        dto.value }),
        ...(dto.stage        !== undefined && { stage:        dto.stage }),
        ...(dto.customerId   !== undefined && { customerId:   dto.customerId }),
        ...(dto.contactId    !== undefined && { contactId:    dto.contactId }),
        ...(dto.leadId       !== undefined && { leadId:       dto.leadId }),
        ...(dto.notes        !== undefined && { notes:        dto.notes }),
        ...(dto.assignedToId !== undefined && { assignedToId: dto.assignedToId }),
        ...(dto.closedAt     !== undefined && { closedAt:     dto.closedAt }),
      },
      select: DEAL_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Deal', entityId: id, action: AuditAction.UPDATE, oldValue: { stage: existing.stage }, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Deal updated successfully', data: deal };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);
    await this.prisma.deal.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'Deal', entityId: id, action: AuditAction.DELETE })
      .catch(() => {});

    return { success: true, message: 'Deal deleted successfully' };
  }

  private async assertExists(id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, select: { id: true, stage: true } });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  private async assertCustomerExists(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException(`Customer with ID ${id} not found`);
  }

  private async assertContactExists(id: string) {
    const c = await this.prisma.contact.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException(`Contact with ID ${id} not found`);
  }

  private async assertLeadExists(id: string) {
    const l = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!l) throw new NotFoundException(`Lead with ID ${id} not found`);
  }
}
