import { Injectable, Logger } from '@nestjs/common';

import { WebsiteAppShowcaseRepository } from './website-app-showcase.repository';

@Injectable()
export class WebsiteAppShowcaseService {
  private readonly logger = new Logger(WebsiteAppShowcaseService.name);

  constructor(private readonly websiteAppShowcaseRepository: WebsiteAppShowcaseRepository) {}

  async getAppShowcase() {
    this.logger.log('GET /website/app-showcase');
    const data = await this.websiteAppShowcaseRepository.findAllActive();
    return { success: true, message: 'App showcase fetched successfully', data };
  }
}
