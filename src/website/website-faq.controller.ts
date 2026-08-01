import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { WebsiteFaqQueryDto } from './dto/website-faq-query.dto';
import { WebsiteFaqService } from './website-faq.service';

@ApiTags('Website / Content')
@Controller('website/faq')
export class WebsiteFaqController {
  constructor(private readonly websiteFaqService: WebsiteFaqService) {}

  @Get()
  @ApiOperation({ summary: 'List active FAQs, ordered by displayOrder — optionally filtered by category' })
  @ApiResponse({
    status: 200,
    description: 'FAQ list',
    schema: {
      example: {
        success: true,
        message: 'FAQs fetched successfully',
        data: [{ id: 'uuid', question: 'How do I book a service?', answer: 'Download the app and select a service.', category: 'booking', displayOrder: 0 }],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  getFaq(@Query() query: WebsiteFaqQueryDto) {
    return this.websiteFaqService.getFaq(query);
  }
}
