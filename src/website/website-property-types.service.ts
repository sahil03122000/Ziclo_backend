import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { WebsitePropertyTypeQueryDto } from './dto/website-property-type-query.dto';
import { WebsitePropertyTypesRepository } from './website-property-types.repository';

function resolveIcon(iconName: string | null, iconUrl: string | null): string | null {
  return iconUrl || iconName || null;
}

@Injectable()
export class WebsitePropertyTypesService {
  private readonly logger = new Logger(WebsitePropertyTypesService.name);

  constructor(private readonly websitePropertyTypesRepository: WebsitePropertyTypesRepository) {}

  async getPropertyTypes(query: WebsitePropertyTypeQueryDto) {
    this.logger.log(`GET /website/property-types?serviceId=${query.serviceId}`);

    const service = await this.websitePropertyTypesRepository.findServiceActive(query.serviceId);
    if (!service) throw new NotFoundException('Service not found');

    const propertyTypes = await this.websitePropertyTypesRepository.findAllActiveForService(query.serviceId);
    const data = propertyTypes.map((pt) => ({
      id: pt.id,
      name: pt.name,
      description: pt.description,
      icon: resolveIcon(pt.iconName, pt.iconUrl),
      displayOrder: pt.displayOrder,
      isActive: pt.isActive,
    }));

    return { success: true, message: 'Property types fetched successfully', data };
  }
}
