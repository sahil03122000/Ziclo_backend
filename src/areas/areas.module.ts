import { Module } from '@nestjs/common';

import { AreasController } from './areas.controller';
import { AreasService } from './areas.service';
import { PincodesController } from './pincodes.controller';
import { PincodesService } from './pincodes.service';

@Module({
  controllers: [AreasController, PincodesController],
  providers: [AreasService, PincodesService],
  exports: [AreasService, PincodesService],
})
export class AreasModule {}
