import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { WebsitePricingOptionQueryDto } from './dto/website-pricing-option-query.dto';
import { WebsitePricingOptionsRepository } from './website-pricing-options.repository';

@Injectable()
export class WebsitePricingOptionsService {
  private readonly logger = new Logger(WebsitePricingOptionsService.name);

  constructor(private readonly websitePricingOptionsRepository: WebsitePricingOptionsRepository) {}

  async getPricingOptions(query: WebsitePricingOptionQueryDto) {
    this.logger.log(`GET /website/pricing-options?packageId=${query.packageId}`);

    const pkg = await this.websitePricingOptionsRepository.findPackageActive(query.packageId);
    if (!pkg) throw new NotFoundException('Package not found');

    const data = await this.websitePricingOptionsRepository.findAllActiveForPackage(query.packageId);
    return { success: true, message: 'Pricing options fetched successfully', data };
  }
}
