import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteAppShowcaseService } from './website-app-showcase.service';

@ApiTags('Website / Content')
@Controller('website/app-showcase')
export class WebsiteAppShowcaseController {
  constructor(private readonly websiteAppShowcaseService: WebsiteAppShowcaseService) {}

  @Get()
  @ApiOperation({ summary: 'List active app showcase items for the website' })
  @ApiResponse({
    status: 200,
    description: 'App showcase list',
    schema: {
      example: {
        success: true,
        message: 'App showcase fetched successfully',
        data: [{ id: 'uuid', title: 'Book in seconds', description: 'A few taps and you\'re done', image: 'https://cdn.example.com/app/screen1.jpg', displayOrder: 0 }],
      },
    },
  })
  getAppShowcase() {
    return this.websiteAppShowcaseService.getAppShowcase();
  }
}
