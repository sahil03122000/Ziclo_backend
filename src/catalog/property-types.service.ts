import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogServicesService } from './services.service';
import { CreatePropertyTypeDto } from './dto/create-property-type.dto';
import { UpdatePropertyTypeDto } from './dto/update-property-type.dto';
import { withSafeIconFields } from './icon-fields.util';

@Injectable()
export class PropertyTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly servicesService: CatalogServicesService,
  ) {}

  async create(serviceId: string, dto: CreatePropertyTypeDto, actorId: string) {
    await this.servicesService.assertExists(serviceId);

    const propertyType = await this.prisma.propertyType.create({
      data: { serviceId, ...withSafeIconFields(dto) },
    });
    this.audit(actorId, propertyType.id, AuditAction.CREATE, { serviceId, ...dto });
    return { success: true, data: propertyType };
  }

  async listForService(serviceId: string) {
    await this.servicesService.assertExists(serviceId);

    const propertyTypes = await this.prisma.propertyType.findMany({
      where: { serviceId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: {
        packages: {
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        },
      },
    });
    return { success: true, data: propertyTypes };
  }

  async update(id: string, dto: UpdatePropertyTypeDto, actorId: string) {
    await this.assertExists(id);
    // An unchanged icon (omitted, or resent as null/blank) must never overwrite the existing
    // iconName/iconUrl — only a genuinely non-blank value is ever written.
    const propertyType = await this.prisma.propertyType.update({ where: { id }, data: withSafeIconFields(dto) });
    this.audit(actorId, id, AuditAction.UPDATE, dto);
    return { success: true, data: propertyType };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);
    // Cascade delete: PropertyType → Package (declared onDelete: Cascade in schema)
    await this.prisma.propertyType.delete({ where: { id } });
    this.audit(actorId, id, AuditAction.DELETE);
    return { success: true, message: 'Property type deleted successfully' };
  }

  async assertExists(id: string) {
    const propertyType = await this.prisma.propertyType.findUnique({ where: { id }, select: { id: true, serviceId: true } });
    if (!propertyType) throw new NotFoundException('Property type not found');
    return propertyType;
  }

  private audit(actorId: string, entityId: string, action: AuditAction, newValue?: unknown) {
    this.auditLogs
      .log({ actorId, entityType: 'PropertyType', entityId, action, newValue: newValue as Record<string, unknown> })
      .catch(() => {});
  }
}
