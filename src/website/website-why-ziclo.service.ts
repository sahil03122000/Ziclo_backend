import { Injectable, Logger } from '@nestjs/common';

import { WebsiteWhyZicloRepository } from './website-why-ziclo.repository';

@Injectable()
export class WebsiteWhyZicloService {
  private readonly logger = new Logger(WebsiteWhyZicloService.name);

  constructor(private readonly websiteWhyZicloRepository: WebsiteWhyZicloRepository) {}

  async getWhyZiclo() {
    this.logger.log('GET /website/why-ziclo');
    const data = await this.websiteWhyZicloRepository.findAllActive();
    return { success: true, message: 'Why Ziclo content fetched successfully', data };
  }
}
