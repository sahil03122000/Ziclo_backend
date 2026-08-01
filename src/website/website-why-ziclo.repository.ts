import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WebsiteWhyZicloRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllActive() {
    return this.prisma.websiteWhyZiclo.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, icon: true, title: true, description: true, displayOrder: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
