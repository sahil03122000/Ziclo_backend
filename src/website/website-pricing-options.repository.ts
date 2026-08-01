import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WebsitePricingOptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPackageActive(packageId: string) {
    return this.prisma.package.findFirst({ where: { id: packageId, isActive: true }, select: { id: true } });
  }

  findAllActiveForPackage(packageId: string) {
    return this.prisma.pricingOption.findMany({
      where: { packageId, isActive: true },
      select: { id: true, label: true, price: true, displayOrder: true },
      orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }],
    });
  }
}
