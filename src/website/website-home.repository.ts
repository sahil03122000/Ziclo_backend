import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'singleton';

@Injectable()
export class WebsiteHomeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive() {
    return this.prisma.websiteHome.findFirst({
      where: { id: SINGLETON_ID, isActive: true, deletedAt: null },
    });
  }
}
