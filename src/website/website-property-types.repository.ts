import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WebsitePropertyTypesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findServiceActive(serviceId: string) {
    return this.prisma.service.findFirst({ where: { id: serviceId, isActive: true }, select: { id: true } });
  }

  findAllActiveForService(serviceId: string) {
    return this.prisma.propertyType.findMany({
      where: { serviceId, isActive: true },
      select: { id: true, name: true, description: true, iconName: true, iconUrl: true, displayOrder: true, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }
}
