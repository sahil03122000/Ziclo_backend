import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PublicServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllActive() {
    const services = await this.prisma.service.findMany({
      where: { isActive: true },
      select: { id: true, name: true, description: true, thumbnail: true, banner: true, iconName: true, iconUrl: true },
      orderBy: { name: 'asc' },
    });
    return { success: true, data: services };
  }

  // Service Detail — customer booking flow.
  async findOne(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        thumbnail: true,
        banner: true,
        iconName: true,
        iconUrl: true,
        isActive: true,
      },
    });
    if (!service) throw new NotFoundException('Service not found');
    return { success: true, data: service };
  }

  async findPropertyTypes(serviceId: string) {
    await this.assertServiceExists(serviceId);

    const propertyTypes = await this.prisma.propertyType.findMany({
      where: { serviceId, isActive: true },
      select: { id: true, name: true, description: true, displayOrder: true, iconName: true, iconUrl: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { success: true, data: propertyTypes };
  }

  async findPackages(propertyTypeId: string) {
    const propertyType = await this.prisma.propertyType.findUnique({
      where: { id: propertyTypeId },
      select: { id: true },
    });
    if (!propertyType) throw new NotFoundException('Property type not found');

    const packages = await this.prisma.package.findMany({
      where: { propertyTypeId, isActive: true },
      select: {
        id: true, name: true, description: true, price: true, durationMinutes: true, iconName: true, iconUrl: true,
        pricingOptions: {
          where: { isActive: true },
          select: { id: true, label: true, price: true, displayOrder: true },
          orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { success: true, data: packages };
  }

  private async assertServiceExists(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id }, select: { id: true } });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }
}
