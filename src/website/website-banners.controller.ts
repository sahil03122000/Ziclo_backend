import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteBannersService } from './website-banners.service';

// Website-only. Reuses the existing Banner table (also backing the Mobile App's
// GET /banners) read-only, under a distinct /website/banners path with a website-shaped
// response (buttonText/buttonUrl) — the Mobile App's own /banners endpoint is untouched.
@ApiTags('Website / Content')
@Controller('website/banners')
export class WebsiteBannersController {
  constructor(private readonly websiteBannersService: WebsiteBannersService) {}

  @Get()
  @ApiOperation({ summary: 'List active banners for the website' })
  @ApiResponse({
    status: 200,
    description: 'Banner list',
    schema: {
      example: {
        success: true,
        message: 'Banners fetched successfully',
        data: [{ id: 'uuid', title: 'Summer Sale', subtitle: '20% off cleaning', image: 'https://cdn.example.com/banner.jpg', buttonText: 'Book Now', buttonUrl: '/services', displayOrder: 0, isActive: true }],
      },
    },
  })
  getBanners() {
    return this.websiteBannersService.getBanners();
  }
}
