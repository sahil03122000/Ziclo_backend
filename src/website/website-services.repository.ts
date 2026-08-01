import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { WebsiteServiceQueryDto } from './dto/website-service-query.dto';

const SERVICE_SELECT = {
  id: true,
  categoryId: true,
  name: true,
  description: true,
  thumbnail: true,
  banner: true,
  iconName: true,
  iconUrl: true,
  isActive: true,
} satisfies Prisma.ServiceSelect;

@Injectable()
export class WebsiteServicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllActive(query: WebsiteServiceQueryDto) {
    const { page = 1, limit = 20, search, categoryId, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ServiceWhereInput = { isActive: true };
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [services, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        select: SERVICE_SELECT,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.service.count({ where }),
    ]);

    return { services, total, page, limit };
  }

  findActiveById(id: string) {
    return this.prisma.service.findFirst({
      where: { id, isActive: true },
      select: {
        ...SERVICE_SELECT,
        category: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Cheapest active PricingOption per service, across every Package under every active
  // PropertyType — the "starting price" shown on the website's service cards/detail page.
  async findStartingPrices(serviceIds: string[]): Promise<Map<string, number>> {
    if (serviceIds.length === 0) return new Map();

    const options = await this.prisma.pricingOption.findMany({
      where: {
        isActive: true,
        package: {
          isActive: true,
          propertyType: { isActive: true, serviceId: { in: serviceIds } },
        },
      },
      select: { price: true, package: { select: { propertyType: { select: { serviceId: true } } } } },
    });

    const startingPrices = new Map<string, number>();
    for (const option of options) {
      const serviceId = option.package.propertyType.serviceId;
      const current = startingPrices.get(serviceId);
      if (current === undefined || option.price < current) {
        startingPrices.set(serviceId, option.price);
      }
    }
    return startingPrices;
  }
}
