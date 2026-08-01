import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { ContactQueryDto } from './dto/contact-query.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

const CONTACT_SELECT = {
  id:             true,
  name:           true,
  email:          true,
  phone:          true,
  position:       true,
  notes:          true,
  isPrimary:      true,
  organizationId: true,
  createdAt:      true,
  updatedAt:      true,
  customer: { select: { id: true, name: true, company: true } },
} satisfies Prisma.ContactSelect;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateContactDto, actorId: string, orgId?: string) {
    await this.assertCustomerExists(dto.customerId);

    const contact = await this.prisma.contact.create({
      data: {
        customerId:     dto.customerId,
        name:           dto.name,
        email:          dto.email,
        phone:          dto.phone,
        position:       dto.position,
        notes:          dto.notes,
        isPrimary:      dto.isPrimary ?? false,
        organizationId: orgId ?? null,
      },
      select: CONTACT_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Contact', entityId: contact.id, action: AuditAction.CREATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Contact created successfully', data: contact };
  }

  async findAll(query: ContactQueryDto, orgId?: string) {
    const { page = 1, limit = 20, search, customerId } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.ContactWhereInput = {};

    if (orgId)      where.organizationId = orgId;
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { name:     { contains: search, mode: 'insensitive' } },
        { email:    { contains: search, mode: 'insensitive' } },
        { phone:    { contains: search, mode: 'insensitive' } },
        { position: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [contacts, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        select: CONTACT_SELECT,
        skip,
        take: limit,
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.contact.count({ where }),
    ]);

    return {
      success: true,
      data: { contacts, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id }, select: CONTACT_SELECT });
    if (!contact) throw new NotFoundException('Contact not found');
    return { success: true, data: contact };
  }

  async update(id: string, dto: UpdateContactDto, actorId: string) {
    await this.assertExists(id);
    if (dto.customerId) await this.assertCustomerExists(dto.customerId);

    const contact = await this.prisma.contact.update({
      where: { id },
      data: {
        ...(dto.customerId !== undefined && { customerId: dto.customerId }),
        ...(dto.name       !== undefined && { name:       dto.name }),
        ...(dto.email      !== undefined && { email:      dto.email }),
        ...(dto.phone      !== undefined && { phone:      dto.phone }),
        ...(dto.position   !== undefined && { position:   dto.position }),
        ...(dto.notes      !== undefined && { notes:      dto.notes }),
        ...(dto.isPrimary  !== undefined && { isPrimary:  dto.isPrimary }),
      },
      select: CONTACT_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Contact', entityId: id, action: AuditAction.UPDATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Contact updated successfully', data: contact };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);
    await this.prisma.contact.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'Contact', entityId: id, action: AuditAction.DELETE })
      .catch(() => {});

    return { success: true, message: 'Contact deleted successfully' };
  }

  private async assertExists(id: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id }, select: { id: true } });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  private async assertCustomerExists(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException(`Customer with ID ${id} not found`);
  }
}
