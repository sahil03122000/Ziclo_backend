import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { WebsiteHomeRepository } from './website-home.repository';

@Injectable()
export class WebsiteHomeService {
  private readonly logger = new Logger(WebsiteHomeService.name);

  constructor(private readonly websiteHomeRepository: WebsiteHomeRepository) {}

  async getHome() {
    this.logger.log('GET /website/home');

    const home = await this.websiteHomeRepository.findActive();
    if (!home) throw new NotFoundException('Website home content not found');

    return { success: true, message: 'Website home content fetched successfully', data: home };
  }
}
