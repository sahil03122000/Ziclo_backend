import { Injectable, Logger } from '@nestjs/common';

import { WebsiteCategoriesRepository } from './website-categories.repository';

@Injectable()
export class WebsiteCategoriesService {
  private readonly logger = new Logger(WebsiteCategoriesService.name);

  constructor(private readonly websiteCategoriesRepository: WebsiteCategoriesRepository) {}

  async getCategories() {
    this.logger.log('GET /website/categories');
    const categories = await this.websiteCategoriesRepository.findAllActive();
    return { success: true, message: 'Categories fetched successfully', data: categories };
  }
}
