import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePricingOptionDto } from './dto/create-pricing-option.dto';
import { UpdatePricingOptionDto } from './dto/update-pricing-option.dto';
import { PackagesService } from './packages.service';

@Injectable()
export class PricingOptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly packagesService: PackagesService,
  ) {}

  async create(packageId: string, dto: CreatePricingOptionDto, actorId: string) {
    await this.packagesService.assertExists(packageId);

    const option = await this.prisma.pricingOption.create({
      data: { packageId, ...dto },
    });
    this.audit(actorId, option.id, AuditAction.CREATE, { packageId, ...dto });
    return { success: true, data: option };
  }

  async listForPackage(packageId: string) {
    await this.packagesService.assertExists(packageId);

    const options = await this.prisma.pricingOption.findMany({
      where: { packageId },
      orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
    });
    return { success: true, data: options };
  }

  async update(id: string, dto: UpdatePricingOptionDto, actorId: string) {
    await this.assertExists(id);
    const option = await this.prisma.pricingOption.update({ where: { id }, data: dto });
    this.audit(actorId, id, AuditAction.UPDATE, dto);
    return { success: true, data: option };
  }

  async remove(id: string, actorId: string) {
    const option = await this.assertExists(id);
    const remaining = await this.prisma.pricingOption.count({ where: { packageId: option.packageId } });
    if (remaining <= 1) {
      throw new BadRequestException('A package must keep at least one pricing option');
    }
    await this.prisma.pricingOption.delete({ where: { id } });
    this.audit(actorId, id, AuditAction.DELETE);
    return { success: true, message: 'Pricing option deleted successfully' };
  }

  async assertExists(id: string) {
    const option = await this.prisma.pricingOption.findUnique({ where: { id }, select: { id: true, packageId: true } });
    if (!option) throw new NotFoundException('Pricing option not found');
    return option;
  }

  private audit(actorId: string, entityId: string, action: AuditAction, newValue?: unknown) {
    this.auditLogs
      .log({ actorId, entityType: 'PricingOption', entityId, action, newValue: newValue as Record<string, unknown> })
      .catch(() => {});
  }
}
