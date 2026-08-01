import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { WebsiteServiceQueryDto } from './dto/website-service-query.dto';
import { WebsiteServicesRepository } from './website-services.repository';

function resolveIcon(iconName: string | null, iconUrl: string | null): string | null {
  return iconUrl || iconName || null;
}

@Injectable()
export class WebsiteServicesService {
  private readonly logger = new Logger(WebsiteServicesService.name);

  constructor(private readonly websiteServicesRepository: WebsiteServicesRepository) {}

  async getServices(query: WebsiteServiceQueryDto) {
    this.logger.log(`GET /website/services ${JSON.stringify(query)}`);

    const { services, total, page, limit } = await this.websiteServicesRepository.findAllActive(query);
    const startingPrices = await this.websiteServicesRepository.findStartingPrices(services.map((s) => s.id));

    const data = services.map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      name: s.name,
      description: s.description,
      thumbnail: s.thumbnail,
      banner: s.banner,
      icon: resolveIcon(s.iconName, s.iconUrl),
      startingPrice: startingPrices.get(s.id) ?? null,
      isActive: s.isActive,
    }));

    return {
      success: true,
      message: 'Services fetched successfully',
      data: { services: data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } },
    };
  }

  async getServiceById(id: string) {
    this.logger.log(`GET /website/services/${id}`);

    const service = await this.websiteServicesRepository.findActiveById(id);
    if (!service) throw new NotFoundException('Service not found');

    const startingPrices = await this.websiteServicesRepository.findStartingPrices([id]);

    return {
      success: true,
      message: 'Service details fetched successfully',
      data: {
        id: service.id,
        categoryId: service.categoryId,
        category: service.category,
        name: service.name,
        description: service.description,
        thumbnail: service.thumbnail,
        banner: service.banner,
        icon: resolveIcon(service.iconName, service.iconUrl),
        startingPrice: startingPrices.get(id) ?? null,
        isActive: service.isActive,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
      },
    };
  }
}
