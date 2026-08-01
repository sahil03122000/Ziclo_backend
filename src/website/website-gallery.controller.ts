import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteGalleryService } from './website-gallery.service';

@ApiTags('Website / Content')
@Controller('website/gallery')
export class WebsiteGalleryController {
  constructor(private readonly websiteGalleryService: WebsiteGalleryService) {}

  @Get()
  @ApiOperation({ summary: 'List active gallery items for the website' })
  @ApiResponse({
    status: 200,
    description: 'Gallery list',
    schema: {
      example: {
        success: true,
        message: 'Gallery fetched successfully',
        data: [{ id: 'uuid', title: 'Solar Panel Cleaning', description: 'Before & after', image: 'https://cdn.example.com/gallery/1.jpg', displayOrder: 0 }],
      },
    },
  })
  getGallery() {
    return this.websiteGalleryService.getGallery();
  }
}
