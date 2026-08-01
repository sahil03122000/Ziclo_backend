import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { WebsiteDownloadLinksRepository } from './website-download-links.repository';

@Injectable()
export class WebsiteDownloadLinksService {
  private readonly logger = new Logger(WebsiteDownloadLinksService.name);

  constructor(private readonly websiteDownloadLinksRepository: WebsiteDownloadLinksRepository) {}

  async getDownloadLinks() {
    this.logger.log('GET /website/download-links');

    const links = await this.websiteDownloadLinksRepository.findActive();
    if (!links) throw new NotFoundException('Download links not found');

    return {
      success: true,
      message: 'Download links fetched successfully',
      data: { android: links.androidUrl, ios: links.iosUrl },
    };
  }
}
