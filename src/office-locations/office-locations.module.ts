import { Module } from '@nestjs/common';

import { OfficeLocationsController } from './office-locations.controller';
import { OfficeLocationsService } from './office-locations.service';

@Module({
  controllers: [OfficeLocationsController],
  providers: [OfficeLocationsService],
  exports: [OfficeLocationsService],
})
export class OfficeLocationsModule {}
