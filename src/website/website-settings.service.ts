import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { WebsiteSettingsRepository } from './website-settings.repository';

@Injectable()
export class WebsiteSettingsService {
  private readonly logger = new Logger(WebsiteSettingsService.name);

  constructor(private readonly websiteSettingsRepository: WebsiteSettingsRepository) {}

  async getSettings() {
    this.logger.log('GET /website/settings');

    const settings = await this.websiteSettingsRepository.findActive();
    if (!settings) throw new NotFoundException('Website settings not found');

    return { success: true, message: 'Website settings fetched successfully', data: settings };
  }
}
