import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteDownloadLinksService } from './website-download-links.service';

@ApiTags('Website / Content')
@Controller('website/download-links')
export class WebsiteDownloadLinksController {
  constructor(private readonly websiteDownloadLinksService: WebsiteDownloadLinksService) {}

  @Get()
  @ApiOperation({ summary: 'Get the app store / play store download links for the website' })
  @ApiResponse({
    status: 200,
    description: 'Download links',
    schema: {
      example: {
        success: true,
        message: 'Download links fetched successfully',
        data: { android: 'https://play.google.com/store/apps/details?id=com.ziclo', ios: 'https://apps.apple.com/app/ziclo/id123456' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Download links not found' })
  getDownloadLinks() {
    return this.websiteDownloadLinksService.getDownloadLinks();
  }
}
