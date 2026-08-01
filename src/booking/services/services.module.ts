import { Module } from '@nestjs/common';

import { CatalogModule } from '../../catalog/catalog.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { BookingServicesController } from './booking-services.controller';
import { PropertyTypesController } from './property-types.controller';
import { ServicesController } from './services.controller';
import { PublicServicesService } from './services.service';

@Module({
  imports: [PrismaModule, CatalogModule],
  controllers: [ServicesController, PropertyTypesController, BookingServicesController],
  providers: [PublicServicesService],
  exports: [PublicServicesService],
})
export class ServicesModule {}
