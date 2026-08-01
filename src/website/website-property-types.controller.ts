import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsitePropertyTypeQueryDto } from './dto/website-property-type-query.dto';
import { WebsitePropertyTypesService } from './website-property-types.service';

// Website-only. Deliberately NOT registered at bare `/property-types` — that path is already
// owned by the Mobile App's authenticated PropertyTypesController
// (src/booking/services/property-types.controller.ts), which uses a path param
// (`/property-types/:propertyTypeId/packages`), not a `?serviceId=` query filter.
@ApiTags('Website / Services')
@Controller('website/property-types')
export class WebsitePropertyTypesController {
  constructor(private readonly websitePropertyTypesService: WebsitePropertyTypesService) {}

  @Get()
  @ApiOperation({ summary: 'List active property types for a service — website' })
  @ApiResponse({
    status: 200,
    description: 'Active property type list',
    schema: {
      example: {
        success: true,
        message: 'Property types fetched successfully',
        data: [{ id: 'uuid', name: 'Residential', description: 'Homes and apartments', icon: 'home-icon', displayOrder: 0, isActive: true }],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error — serviceId is required' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  getPropertyTypes(@Query() query: WebsitePropertyTypeQueryDto) {
    return this.websitePropertyTypesService.getPropertyTypes(query);
  }
}
