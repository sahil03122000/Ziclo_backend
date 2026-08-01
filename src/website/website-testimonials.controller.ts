import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteTestimonialQueryDto } from './dto/website-testimonial-query.dto';
import { WebsiteTestimonialsService } from './website-testimonials.service';

@ApiTags('Website / Content')
@Controller('website/testimonials')
export class WebsiteTestimonialsController {
  constructor(private readonly websiteTestimonialsService: WebsiteTestimonialsService) {}

  @Get()
  @ApiOperation({ summary: 'List active testimonials — paginated, searchable, filterable by rating, sortable' })
  @ApiResponse({
    status: 200,
    description: 'Paginated testimonial list',
    schema: {
      example: {
        success: true,
        message: 'Testimonials fetched successfully',
        data: {
          testimonials: [{ id: 'uuid', name: 'Priya Sharma', designation: 'Homeowner', message: 'Excellent service!', rating: 5, image: 'https://cdn.example.com/t/1.jpg', displayOrder: 0 }],
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  getTestimonials(@Query() query: WebsiteTestimonialQueryDto) {
    return this.websiteTestimonialsService.getTestimonials(query);
  }
}
