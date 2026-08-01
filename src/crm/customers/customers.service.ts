import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';

import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const CUSTOMER_SELECT = {
  id:             true,
  name:           true,
  email:          true,
  phone:          true,
  company:        true,
  address:        true,
  notes:          true,
  isActive:       true,
  organizationId: true,
  createdAt:      true,
  updatedAt:      true,
} satisfies Prisma.CustomerSelect;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(dto: CreateCustomerDto, actorId: string, orgId?: string) {
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
        address:        dto.address,
        notes:          dto.notes,
        organizationId: orgId ?? null,
      },
      select: CUSTOMER_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Customer', entityId: customer.id, action: AuditAction.CREATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Customer created successfully', data: customer };
  }

  async findAll(query: CustomerQueryDto, orgId?: string) {
    const { page = 1, limit = 20, search, isActive } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.CustomerWhereInput = {};

    if (orgId !== undefined)  where.organizationId = orgId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name:    { contains: search, mode: 'insensitive' } },
        { email:   { contains: search, mode: 'insensitive' } },
        { phone:   { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({ where, select: CUSTOMER_SELECT, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      success: true,
      data: { customers, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: {
        ...CUSTOMER_SELECT,
        contacts: {
          select: { id: true, name: true, email: true, phone: true, position: true, isPrimary: true },
          orderBy: { isPrimary: 'desc' },
        },
        _count: { select: { leads: true, deals: true, activities: true } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return { success: true, data: customer };
  }

  async update(id: string, dto: UpdateCustomerDto, actorId: string) {
    await this.assertExists(id);

    if (dto.email !== undefined) {
      const conflict = await this.prisma.customer.findFirst({
        where: { email: dto.email.toLowerCase(), NOT: { id } },
        select: { id: true },
      });
      if (conflict) throw new ConflictException('Email is already in use');
    }
    if (dto.phone !== undefined) {
      const conflict = await this.prisma.customer.findFirst({
        where: { phone: dto.phone, NOT: { id } },
        select: { id: true },
      });
      if (conflict) throw new ConflictException('Phone number is already in use');
    }

    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.name     !== undefined && { name:     dto.name }),
        ...(dto.email    !== undefined && { email:    dto.email.toLowerCase() }),
        ...(dto.phone    !== undefined && { phone:    dto.phone }),
        ...(dto.company  !== undefined && { company:  dto.company }),
        ...(dto.address  !== undefined && { address:  dto.address }),
        ...(dto.notes    !== undefined && { notes:    dto.notes }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: CUSTOMER_SELECT,
    });

    this.auditLogs
      .log({ actorId, entityType: 'Customer', entityId: id, action: AuditAction.UPDATE, newValue: { ...dto } })
      .catch(() => {});

    return { success: true, message: 'Customer updated successfully', data: customer };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);
    await this.prisma.customer.delete({ where: { id } });

    this.auditLogs
      .log({ actorId, entityType: 'Customer', entityId: id, action: AuditAction.DELETE })
      .catch(() => {});

    return { success: true, message: 'Customer deleted successfully' };
  }

  private async assertExists(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
