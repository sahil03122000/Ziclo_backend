import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { WebsiteSeoQueryDto } from './dto/website-seo-query.dto';
import { WebsiteSeoRepository } from './website-seo.repository';

@Injectable()
export class WebsiteSeoService {
  private readonly logger = new Logger(WebsiteSeoService.name);

  constructor(private readonly websiteSeoRepository: WebsiteSeoRepository) {}

  async getSeo(query: WebsiteSeoQueryDto) {
    this.logger.log(`GET /website/seo?page=${query.page}`);

    const seo = await this.websiteSeoRepository.findByPage(query.page);
    if (!seo) throw new NotFoundException(`SEO metadata not found for page "${query.page}"`);

    return { success: true, message: 'Website SEO metadata fetched successfully', data: seo };
  }
}
