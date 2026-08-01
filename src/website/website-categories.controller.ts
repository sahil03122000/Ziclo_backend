import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteCategoriesService } from './website-categories.service';

// Website-only — the Mobile App has no concept of categories, so this lives under /website
// rather than a bare /categories path (kept out of the Mobile App's route namespace entirely).
@ApiTags('Website / Services')
@Controller('website/categories')
export class WebsiteCategoriesController {
  constructor(private readonly websiteCategoriesService: WebsiteCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List active service categories for the website' })
  @ApiResponse({
    status: 200,
    description: 'Category list',
    schema: {
      example: {
        success: true,
        message: 'Categories fetched successfully',
        data: [{ id: 'uuid', name: 'Cleaning', description: 'Home cleaning services', image: 'https://cdn.example.com/cat/cleaning.jpg', icon: 'broom-icon', displayOrder: 0, isActive: true }],
      },
    },
  })
  getCategories() {
    return this.websiteCategoriesService.getCategories();
  }
}
