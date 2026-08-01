import { Injectable, Logger } from '@nestjs/common';

import { WebsiteStatisticsRepository } from './website-statistics.repository';

@Injectable()
export class WebsiteStatisticsService {
  private readonly logger = new Logger(WebsiteStatisticsService.name);

  constructor(private readonly websiteStatisticsRepository: WebsiteStatisticsRepository) {}

  async getStatistics() {
    this.logger.log('GET /website/statistics');

    const statistics = await this.websiteStatisticsRepository.findAllActive();
    return { success: true, message: 'Website statistics fetched successfully', data: statistics };
  }
}
