import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WebsiteSeoRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByPage(page: string) {
    return this.prisma.websiteSeo.findFirst({
      where: { page, isActive: true, deletedAt: null },
    });
  }
}
