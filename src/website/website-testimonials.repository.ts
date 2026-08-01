import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { WebsiteTestimonialQueryDto } from './dto/website-testimonial-query.dto';

@Injectable()
export class WebsiteTestimonialsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllActive(query: WebsiteTestimonialQueryDto) {
    const { page = 1, limit = 20, search, rating, sortBy = 'displayOrder', sortOrder = 'asc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.WebsiteTestimonialWhereInput = { isActive: true, deletedAt: null };
    if (rating) where.rating = rating;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [testimonials, total] = await this.prisma.$transaction([
      this.prisma.websiteTestimonial.findMany({
        where,
        select: { id: true, name: true, designation: true, message: true, rating: true, image: true, displayOrder: true },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.websiteTestimonial.count({ where }),
    ]);

    return { testimonials, total, page, limit };
  }
}
