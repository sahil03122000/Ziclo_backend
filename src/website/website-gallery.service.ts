import { Injectable, Logger } from '@nestjs/common';

import { WebsiteGalleryRepository } from './website-gallery.repository';

@Injectable()
export class WebsiteGalleryService {
  private readonly logger = new Logger(WebsiteGalleryService.name);

  constructor(private readonly websiteGalleryRepository: WebsiteGalleryRepository) {}

  async getGallery() {
    this.logger.log('GET /website/gallery');
    const data = await this.websiteGalleryRepository.findAllActive();
    return { success: true, message: 'Gallery fetched successfully', data };
  }
}
