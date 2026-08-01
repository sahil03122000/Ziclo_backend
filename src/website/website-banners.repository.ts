import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WebsiteBannersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Reuses the existing Banner table (shared with the Mobile App's GET /banners) — read-only,
  // no write path added here, so the Mobile App's admin CRUD/reordering is entirely unaffected.
  findAllActive() {
    return this.prisma.banner.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, title: true, subtitle: true, imageUrl: true, buttonText: true, redirectValue: true, displayOrder: true, isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
  }
}
