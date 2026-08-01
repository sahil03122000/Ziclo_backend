import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteServiceQueryDto } from './dto/website-service-query.dto';
import { WebsiteServicesService } from './website-services.service';

// Website-only. Deliberately NOT registered at bare `/services` or `/services/:id` — those
// paths are already owned by the Mobile App's authenticated ServicesController
// (src/booking/services/services.controller.ts) with a different response shape (no
// categoryId/startingPrice, no pagination/search/sort) and must not be touched or shadowed.
@ApiTags('Website / Services')
@Controller('website/services')
export class WebsiteServicesController {
  constructor(private readonly websiteServicesService: WebsiteServicesService) {}

  @Get()
  @ApiOperation({ summary: 'List active services for the website — paginated, searchable, sortable, filterable by category' })
  @ApiResponse({
    status: 200,
    description: 'Paginated service list',
    schema: {
      example: {
        success: true,
        message: 'Services fetched successfully',
        data: {
          services: [{ id: 'uuid', categoryId: 'uuid', name: 'Solar Cleaning', description: '...', thumbnail: 'url', banner: 'url', icon: 'url-or-name', startingPrice: 499, isActive: true }],
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  getServices(@Query() query: WebsiteServiceQueryDto) {
    return this.websiteServicesService.getServices(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Complete website service details' })
  @ApiResponse({
    status: 200,
    description: 'Service detail',
    schema: {
      example: {
        success: true,
        message: 'Service details fetched successfully',
        data: { id: 'uuid', categoryId: 'uuid', category: { id: 'uuid', name: 'Cleaning' }, name: 'Solar Cleaning', description: '...', thumbnail: 'url', banner: 'url', icon: 'url-or-name', startingPrice: 499, isActive: true },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Service not found' })
  getServiceById(@Param('id', ParseUUIDPipe) id: string) {
    return this.websiteServicesService.getServiceById(id);
  }
}
