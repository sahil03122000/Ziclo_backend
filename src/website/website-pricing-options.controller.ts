import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsitePricingOptionQueryDto } from './dto/website-pricing-option-query.dto';
import { WebsitePricingOptionsService } from './website-pricing-options.service';

// Website-only. No bare `/pricing-options` route exists for the Mobile App today — net-new
// path, kept under /website for namespace consistency with the rest of Module 2.
@ApiTags('Website / Services')
@Controller('website/pricing-options')
export class WebsitePricingOptionsController {
  constructor(private readonly websitePricingOptionsService: WebsitePricingOptionsService) {}

  @Get()
  @ApiOperation({ summary: 'List active pricing options for a package — website' })
  @ApiResponse({
    status: 200,
    description: 'Active pricing option list',
    schema: {
      example: {
        success: true,
        message: 'Pricing options fetched successfully',
        data: [{ id: 'uuid', label: '1 Unit', price: 399, displayOrder: 0 }],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error — packageId is required' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  getPricingOptions(@Query() query: WebsitePricingOptionQueryDto) {
    return this.websitePricingOptionsService.getPricingOptions(query);
  }
}
