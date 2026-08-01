import { Injectable, Logger } from '@nestjs/common';

import { WebsiteBannersRepository } from './website-banners.repository';

@Injectable()
export class WebsiteBannersService {
  private readonly logger = new Logger(WebsiteBannersService.name);

  constructor(private readonly websiteBannersRepository: WebsiteBannersRepository) {}

  async getBanners() {
    this.logger.log('GET /website/banners');

    const banners = await this.websiteBannersRepository.findAllActive();
    const data = banners.map((b) => ({
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      image: b.imageUrl,
      buttonText: b.buttonText,
      buttonUrl: b.redirectValue,
      displayOrder: b.displayOrder,
      isActive: b.isActive,
    }));

    return { success: true, message: 'Banners fetched successfully', data };
  }
}
