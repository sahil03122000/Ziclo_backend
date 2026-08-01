import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteStatisticsService } from './website-statistics.service';

@ApiTags('Website')
@Controller('website/statistics')
export class WebsiteStatisticsController {
  constructor(private readonly websiteStatisticsService: WebsiteStatisticsService) {}

  @Get()
  @ApiOperation({ summary: 'Get public website statistics (e.g. "500+ Happy Customers"), ordered for display' })
  @ApiResponse({
    status: 200,
    description: 'Website statistics list',
    schema: {
      example: {
        success: true,
        message: 'Website statistics fetched successfully',
        data: [
          { id: 'uuid', label: 'Happy Customers', value: '500+', iconName: 'smile-icon', displayOrder: 0 },
          { id: 'uuid', label: 'Cities Covered', value: '20+', iconName: 'map-icon', displayOrder: 1 },
        ],
      },
    },
  })
  getStatistics() {
    return this.websiteStatisticsService.getStatistics();
  }
}
