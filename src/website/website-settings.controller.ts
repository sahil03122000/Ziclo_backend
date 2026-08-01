import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteSettingsService } from './website-settings.service';

@ApiTags('Website')
@Controller('website/settings')
export class WebsiteSettingsController {
  constructor(private readonly websiteSettingsService: WebsiteSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get public website settings (site name, logo, contact info, social links)' })
  @ApiResponse({
    status: 200,
    description: 'Website settings',
    schema: {
      example: {
        success: true,
        message: 'Website settings fetched successfully',
        data: {
          id: 'singleton',
          siteName: 'Ziclo',
          logoUrl: 'https://cdn.example.com/logo.png',
          contactEmail: 'support@ziclo.com',
          contactPhone: '+91-9999999999',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Website settings not found' })
  getSettings() {
    return this.websiteSettingsService.getSettings();
  }
}
