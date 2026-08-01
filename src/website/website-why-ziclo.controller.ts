import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteWhyZicloService } from './website-why-ziclo.service';

@ApiTags('Website / Content')
@Controller('website/why-ziclo')
export class WebsiteWhyZicloController {
  constructor(private readonly websiteWhyZicloService: WebsiteWhyZicloService) {}

  @Get()
  @ApiOperation({ summary: 'List active "Why Ziclo" highlights for the website' })
  @ApiResponse({
    status: 200,
    description: 'Why Ziclo list',
    schema: {
      example: {
        success: true,
        message: 'Why Ziclo content fetched successfully',
        data: [{ id: 'uuid', icon: 'shield-check-icon', title: 'Verified Professionals', description: 'All workers are background-checked', displayOrder: 0 }],
      },
    },
  })
  getWhyZiclo() {
    return this.websiteWhyZicloService.getWhyZiclo();
  }
}
