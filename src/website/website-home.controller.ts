import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteHomeService } from './website-home.service';

@ApiTags('Website')
@Controller('website/home')
export class WebsiteHomeController {
  constructor(private readonly websiteHomeService: WebsiteHomeService) {}

  @Get()
  @ApiOperation({ summary: 'Get public website home page content (hero section)' })
  @ApiResponse({
    status: 200,
    description: 'Website home content',
    schema: {
      example: {
        success: true,
        message: 'Website home content fetched successfully',
        data: {
          id: 'singleton',
          heroTitle: 'Home Services Made Easy',
          heroSubtitle: 'Book trusted professionals in minutes',
          heroImageUrl: 'https://cdn.example.com/hero.jpg',
          heroCtaText: 'Book Now',
          heroCtaLink: '/services',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Website home content not found' })
  getHome() {
    return this.websiteHomeService.getHome();
  }
}
