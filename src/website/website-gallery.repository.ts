import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WebsiteGalleryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllActive() {
    return this.prisma.websiteGalleryItem.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, title: true, description: true, image: true, displayOrder: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
