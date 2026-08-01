import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(userId: string, dto: CreateAddressDto) {
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }

    const isFirst = (await this.prisma.address.count({ where: { userId } })) === 0;

    const address = await this.prisma.address.create({
      data: { userId, ...dto, isDefault: dto.isDefault ?? isFirst },
    });

    this.auditLogs
      .log({ actorId: userId, entityType: 'Address', entityId: address.id, action: AuditAction.CREATE })
      .catch(() => {});

    return { success: true, message: 'Address created', data: address };
  }

  async findAll(userId: string) {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return { success: true, data: addresses };
  }

  async findOne(id: string, userId: string) {
    const address = await this.requireOwned(id, userId);
    return { success: true, data: address };
  }

  async update(id: string, userId: string, dto: UpdateAddressDto) {
    await this.requireOwned(id, userId);

    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }

    const address = await this.prisma.address.update({ where: { id }, data: { ...dto } });

    this.auditLogs
      .log({ actorId: userId, entityType: 'Address', entityId: id, action: AuditAction.UPDATE })
      .catch(() => {});

    return { success: true, message: 'Address updated', data: address };
  }

  async remove(id: string, userId: string) {
    const address = await this.requireOwned(id, userId);
    await this.prisma.address.delete({ where: { id } });

    if (address.isDefault) {
      const next = await this.prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
      if (next) await this.prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }

    this.auditLogs
      .log({ actorId: userId, entityType: 'Address', entityId: id, action: AuditAction.DELETE })
      .catch(() => {});

    return { success: true, message: 'Address deleted' };
  }

  async setDefault(id: string, userId: string) {
    await this.requireOwned(id, userId);
    await this.prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    const address = await this.prisma.address.update({ where: { id }, data: { isDefault: true } });
    return { success: true, message: 'Default address updated', data: address };
  }

  private async requireOwned(id: string, userId: string) {
    const address = await this.prisma.address.findUnique({ where: { id } });
    if (!address) throw new NotFoundException('Address not found');
    if (address.userId !== userId) throw new ForbiddenException('Access denied');
    return address;
  }
}
