import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyTypesService } from './property-types.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { UpdatePackageStatusDto } from './dto/update-package-status.dto';
import { withSafeIconFields } from './icon-fields.util';

@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly propertyTypesService: PropertyTypesService,
  ) {}

  async create(propertyTypeId: string, dto: CreatePackageDto, actorId: string) {
    await this.propertyTypesService.assertExists(propertyTypeId);

    const pkg = await this.prisma.package.create({ data: { propertyTypeId, ...withSafeIconFields(dto) } });
    this.audit(actorId, pkg.id, AuditAction.CREATE, { propertyTypeId, ...dto });
    return { success: true, data: pkg };
  }

  async listForPropertyType(propertyTypeId: string) {
    await this.propertyTypesService.assertExists(propertyTypeId);

    const packages = await this.prisma.package.findMany({
      where: { propertyTypeId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { success: true, data: packages };
  }

  async update(id: string, dto: UpdatePackageDto, actorId: string) {
    await this.assertExists(id);
    // An unchanged icon (omitted, or resent as null/blank) must never overwrite the existing
    // iconName/iconUrl — only a genuinely non-blank value is ever written.
    const pkg = await this.prisma.package.update({ where: { id }, data: withSafeIconFields(dto) });
    this.audit(actorId, id, AuditAction.UPDATE, dto);
    return { success: true, data: pkg };
  }

  async updateStatus(id: string, dto: UpdatePackageStatusDto, actorId: string) {
    await this.assertExists(id);
    const pkg = await this.prisma.package.update({ where: { id }, data: { isActive: dto.isActive } });
    this.audit(actorId, id, AuditAction.STATUS_CHANGE, dto);
    return { success: true, data: pkg };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);
    await this.prisma.package.delete({ where: { id } });
    this.audit(actorId, id, AuditAction.DELETE);
    return { success: true, message: 'Package deleted successfully' };
  }

  async assertExists(id: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id }, select: { id: true } });
    if (!pkg) throw new NotFoundException('Package not found');
    return pkg;
  }

  private audit(actorId: string, entityId: string, action: AuditAction, newValue?: unknown) {
    this.auditLogs
      .log({ actorId, entityType: 'Package', entityId, action, newValue: newValue as Record<string, unknown> })
      .catch(() => {});
  }
}
