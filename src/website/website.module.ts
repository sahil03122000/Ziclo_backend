import { Module } from '@nestjs/common';

import { WebsiteAppShowcaseController } from './website-app-showcase.controller';
import { WebsiteAppShowcaseRepository } from './website-app-showcase.repository';
import { WebsiteAppShowcaseService } from './website-app-showcase.service';
import { WebsiteBannersController } from './website-banners.controller';
import { WebsiteBannersRepository } from './website-banners.repository';
import { WebsiteBannersService } from './website-banners.service';
import { WebsiteCategoriesController } from './website-categories.controller';
import { WebsiteCategoriesRepository } from './website-categories.repository';
import { WebsiteCategoriesService } from './website-categories.service';
import { WebsiteDownloadLinksController } from './website-download-links.controller';
import { WebsiteDownloadLinksRepository } from './website-download-links.repository';
import { WebsiteDownloadLinksService } from './website-download-links.service';
import { WebsiteFaqController } from './website-faq.controller';
import { WebsiteFaqRepository } from './website-faq.repository';
import { WebsiteFaqService } from './website-faq.service';
import { WebsiteGalleryController } from './website-gallery.controller';
import { WebsiteGalleryRepository } from './website-gallery.repository';
import { WebsiteGalleryService } from './website-gallery.service';
import { WebsiteHomeController } from './website-home.controller';
import { WebsiteHomeRepository } from './website-home.repository';
import { WebsiteHomeService } from './website-home.service';
import { WebsitePackagesController } from './website-packages.controller';
import { WebsitePackagesRepository } from './website-packages.repository';
import { WebsitePackagesService } from './website-packages.service';
import { WebsitePricingOptionsController } from './website-pricing-options.controller';
import { WebsitePricingOptionsRepository } from './website-pricing-options.repository';
import { WebsitePricingOptionsService } from './website-pricing-options.service';
import { WebsitePropertyTypesController } from './website-property-types.controller';
import { WebsitePropertyTypesRepository } from './website-property-types.repository';
import { WebsitePropertyTypesService } from './website-property-types.service';
import { WebsiteSeoController } from './website-seo.controller';
import { WebsiteSeoRepository } from './website-seo.repository';
import { WebsiteSeoService } from './website-seo.service';
import { WebsiteServicesController } from './website-services.controller';
import { WebsiteServicesRepository } from './website-services.repository';
import { WebsiteServicesService } from './website-services.service';
import { WebsiteSettingsController } from './website-settings.controller';
import { WebsiteSettingsRepository } from './website-settings.repository';
import { WebsiteSettingsService } from './website-settings.service';
import { WebsiteStatisticsController } from './website-statistics.controller';
import { WebsiteStatisticsRepository } from './website-statistics.repository';
import { WebsiteStatisticsService } from './website-statistics.service';
import { WebsiteTestimonialsController } from './website-testimonials.controller';
import { WebsiteTestimonialsRepository } from './website-testimonials.repository';
import { WebsiteTestimonialsService } from './website-testimonials.service';
import { WebsiteWhyZicloController } from './website-why-ziclo.controller';
import { WebsiteWhyZicloRepository } from './website-why-ziclo.repository';
import { WebsiteWhyZicloService } from './website-why-ziclo.service';

@Module({
  controllers: [
    // Module 1
    WebsiteSettingsController,
    WebsiteHomeController,
    WebsiteStatisticsController,
    WebsiteSeoController,
    // Module 2
    WebsiteCategoriesController,
    WebsiteServicesController,
    WebsitePropertyTypesController,
    WebsitePackagesController,
    WebsitePricingOptionsController,
    // Module 3
    WebsiteBannersController,
    WebsiteGalleryController,
    WebsiteWhyZicloController,
    WebsiteAppShowcaseController,
    WebsiteDownloadLinksController,
    WebsiteTestimonialsController,
    WebsiteFaqController,
  ],
  providers: [
    // Module 1
    WebsiteSettingsRepository,
    WebsiteSettingsService,
    WebsiteHomeRepository,
    WebsiteHomeService,
    WebsiteStatisticsRepository,
    WebsiteStatisticsService,
    WebsiteSeoRepository,
    WebsiteSeoService,
    // Module 2
    WebsiteCategoriesRepository,
    WebsiteCategoriesService,
    WebsiteServicesRepository,
    WebsiteServicesService,
    WebsitePropertyTypesRepository,
    WebsitePropertyTypesService,
    WebsitePackagesRepository,
    WebsitePackagesService,
    WebsitePricingOptionsRepository,
    WebsitePricingOptionsService,
    // Module 3
    WebsiteBannersRepository,
    WebsiteBannersService,
    WebsiteGalleryRepository,
    WebsiteGalleryService,
    WebsiteWhyZicloRepository,
    WebsiteWhyZicloService,
    WebsiteAppShowcaseRepository,
    WebsiteAppShowcaseService,
    WebsiteDownloadLinksRepository,
    WebsiteDownloadLinksService,
    WebsiteTestimonialsRepository,
    WebsiteTestimonialsService,
    WebsiteFaqRepository,
    WebsiteFaqService,
  ],
})
export class WebsiteModule {}
