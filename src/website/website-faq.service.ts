import { Injectable, Logger } from '@nestjs/common';

import { WebsiteFaqQueryDto } from './dto/website-faq-query.dto';
import { WebsiteFaqRepository } from './website-faq.repository';

@Injectable()
export class WebsiteFaqService {
  private readonly logger = new Logger(WebsiteFaqService.name);

  constructor(private readonly websiteFaqRepository: WebsiteFaqRepository) {}

  async getFaq(query: WebsiteFaqQueryDto) {
    this.logger.log(`GET /website/faq ${JSON.stringify(query)}`);
    const data = await this.websiteFaqRepository.findAllActive(query);
    return { success: true, message: 'FAQs fetched successfully', data };
  }
}
