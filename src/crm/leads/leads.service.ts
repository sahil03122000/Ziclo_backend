import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, LeadStatus, Prisma } from '@prisma/client';

import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadQueryDto } from './dto/lead-query.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';

const LEAD_SELECT = {
  id: true,
  title: true,
  status: true,
  value: true,
  source: true,
  description: true,
  closedAt: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
  customer:   { select: { id: true, name: true, company: true } },
  contact:    { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  createdBy:  { select: { id: true, name: true, email: true } },
} satisfies Prisma.LeadSelect;

const TERMINAL_STATUSES: LeadStatus[] = [LeadStatus.WON, LeadStatus.LOST];

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateLeadDto, actorId: string, orgId?: string) {
    if (dto.customerId) await this.assertCustomerExists(dto.customerId);
    if (dto.contactId)  await this.assertContactExists(dto.contactId);

    const lead = await this.prisma.lead.create({
      data: {
        title:          dto.title,
        value:          dto.value,
        source:         dto.source,
        description:    dto.description,
        customerId:     dto.customerId,
        contactId:      dto.contactId,
        assignedToId:   dto.assignedToId,
        createdById:    actorId,
        organizationId: orgId ?? null,
      },
      select: LEAD_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Lead', entityId: lead.id, action: AuditAction.CREATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Lead created successfully', data: lead };
  }

  async findAll(query: LeadQueryDto, orgId?: string) {
    const { page = 1, limit = 20, search, status, customerId, assignedToId } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.LeadWhereInput = {};

    if (orgId)       where.organizationId = orgId;
    if (status)      where.status = status;
    if (customerId)  where.customerId = customerId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) {
      where.OR = [
        { title:  { contains: search, mode: 'insensitive' } },
        { source: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [leads, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({ where, select: LEAD_SELECT, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      success: true,
      data: { leads, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, select: LEAD_SELECT });
    if (!lead) throw new NotFoundException('Lead not found');
    return { success: true, data: lead };
  }

  async update(id: string, dto: UpdateLeadDto, actorId: string) {
    const existing = await this.assertExists(id);
    if (dto.customerId) await this.assertCustomerExists(dto.customerId);
    if (dto.contactId)  await this.assertContactExists(dto.contactId);

    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        ...(dto.title        !== undefined && { title:        dto.title }),
        ...(dto.value        !== undefined && { value:        dto.value }),
        ...(dto.source       !== undefined && { source:       dto.source }),
        ...(dto.description  !== undefined && { description:  dto.description }),
        ...(dto.customerId   !== undefined && { customerId:   dto.customerId }),
        ...(dto.contactId    !== undefined && { contactId:    dto.contactId }),
        ...(dto.assignedToId !== undefined && { assignedToId: dto.assignedToId }),
        ...(dto.closedAt     !== undefined && { closedAt:     dto.closedAt }),
      },
      select: LEAD_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Lead', entityId: id, action: AuditAction.UPDATE, oldValue: { status: existing.status }, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Lead updated successfully', data: lead };
  }

  async updateStatus(id: string, dto: UpdateLeadStatusDto, actorId: string) {
    const existing = await this.assertExists(id);

    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        status:   dto.status,
        closedAt: TERMINAL_STATUSES.includes(dto.status) ? new Date() : null,
      },
      select: LEAD_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Lead', entityId: id, action: AuditAction.STATUS_CHANGE, oldValue: { status: existing.status }, newValue: { status: dto.status } })
      .catch(() => {});

    return { success: true, message: 'Lead status updated successfully', data: lead };
  }

  async convertToCustomer(leadId: string, dto: ConvertLeadDto, actorId: string, orgId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, title: true, status: true, customerId: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    if (lead.status === LeadStatus.WON) {
      throw new BadRequestException('Lead has already been converted (WON)');
    }
    if (lead.status === LeadStatus.LOST) {
      throw new BadRequestException('Cannot convert a lost lead');
    }

    let customerId = lead.customerId;

    if (!customerId) {
      if (!dto.name) {
        throw new BadRequestException('Customer name is required when lead has no linked customer');
      }
      if (dto.email) {
        const conflict = await this.prisma.customer.findUnique({
          where: { email: dto.email.toLowerCase() },
          select: { id: true },
        });
        if (conflict) throw new ConflictException('A customer with this email already exists');
      }
      if (dto.phone) {
        const conflict = await this.prisma.customer.findUnique({
          where: { phone: dto.phone },
          select: { id: true },
        });
        if (conflict) throw new ConflictException('A customer with this phone already exists');
      }

      const customer = await this.prisma.customer.create({
        data: {
          name:           dto.name,
          email:          dto.email ? dto.email.toLowerCase() : undefined,
          phone:          dto.phone,
          company:        dto.company,
          organizationId: orgId ?? null,
        },
        select: { id: true },
      });
      customerId = customer.id;
    }

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data:  { status: LeadStatus.WON, closedAt: new Date(), customerId },
      select: LEAD_SELECT,
    });

    this.auditLogs
      .log({
        actorId,
        entityType: 'Lead',
        entityId:   leadId,
        action:     AuditAction.STATUS_CHANGE,
        oldValue:   { status: lead.status },
        newValue:   { status: LeadStatus.WON, convertedToCustomerId: customerId },
      })
      .catch(() => {});

    return { success: true, message: 'Lead converted to customer and marked as WON', data: updated };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);
    await this.prisma.lead.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'Lead', entityId: id, action: AuditAction.DELETE })
      .catch(() => {});

    return { success: true, message: 'Lead deleted successfully' };
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private async assertExists(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  private async assertCustomerExists(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException(`Customer with ID ${id} not found`);
  }

  private async assertContactExists(id: string) {
    const c = await this.prisma.contact.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException(`Contact with ID ${id} not found`);
  }
}
