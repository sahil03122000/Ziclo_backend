import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { WebsiteFaqQueryDto } from './dto/website-faq-query.dto';

@Injectable()
export class WebsiteFaqRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllActive(query: WebsiteFaqQueryDto) {
    const where: Prisma.WebsiteFaqWhereInput = { isActive: true, deletedAt: null };
    if (query.category) where.category = query.category;

    return this.prisma.websiteFaq.findMany({
      where,
      select: { id: true, question: true, answer: true, category: true, displayOrder: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
