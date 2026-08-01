import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogController } from './catalog.controller';
import { PackagesService } from './packages.service';
import { PricingOptionsService } from './pricing-options.service';
import { PropertyTypesService } from './property-types.service';
import { CatalogServicesService } from './services.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CatalogController],
  providers: [CatalogServicesService, PropertyTypesService, PackagesService, PricingOptionsService],
  exports: [CatalogServicesService, PropertyTypesService, PackagesService, PricingOptionsService],
})
export class CatalogModule {}
