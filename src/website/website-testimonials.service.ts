import { Injectable, Logger } from '@nestjs/common';

import { WebsiteTestimonialQueryDto } from './dto/website-testimonial-query.dto';
import { WebsiteTestimonialsRepository } from './website-testimonials.repository';

@Injectable()
export class WebsiteTestimonialsService {
  private readonly logger = new Logger(WebsiteTestimonialsService.name);

  constructor(private readonly websiteTestimonialsRepository: WebsiteTestimonialsRepository) {}

  async getTestimonials(query: WebsiteTestimonialQueryDto) {
    this.logger.log(`GET /website/testimonials ${JSON.stringify(query)}`);

    const { testimonials, total, page, limit } = await this.websiteTestimonialsRepository.findAllActive(query);

    return {
      success: true,
      message: 'Testimonials fetched successfully',
      data: { testimonials, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }
}
