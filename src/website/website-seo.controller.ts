import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteSeoQueryDto } from './dto/website-seo-query.dto';
import { WebsiteSeoService } from './website-seo.service';

@ApiTags('Website')
@Controller('website/seo')
export class WebsiteSeoController {
  constructor(private readonly websiteSeoService: WebsiteSeoService) {}

  @Get()
  @ApiOperation({ summary: 'Get SEO metadata (title, description, keywords, OG image) for a given page' })
  @ApiResponse({
    status: 200,
    description: 'Website SEO metadata',
    schema: {
      example: {
        success: true,
        message: 'Website SEO metadata fetched successfully',
        data: {
          id: 'uuid',
          page: 'home',
          title: 'Ziclo — Home Services Made Easy',
          description: 'Book trusted home service professionals near you.',
          keywords: 'home services, cleaning, repair',
          ogImage: 'https://cdn.example.com/og/home.jpg',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error — page query param is required' })
  @ApiResponse({ status: 404, description: 'SEO metadata not found for the given page' })
  getSeo(@Query() query: WebsiteSeoQueryDto) {
    return this.websiteSeoService.getSeo(query);
  }
}
