import { Module } from '@nestjs/common';

import { BookingConfigController } from './booking-config.controller';
import { BookingConfigService } from './booking-config.service';

@Module({
  controllers: [BookingConfigController],
  providers: [BookingConfigService],
})
export class BookingConfigModule {}
