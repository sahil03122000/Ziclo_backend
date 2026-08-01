import { Module } from '@nestjs/common';

import { BookingConfigModule } from './booking-config/booking-config.module';
import { BookingsModule } from './bookings/bookings.module';
import { ServicesModule } from './services/services.module';
import { TimeSlotsModule } from './time-slots/time-slots.module';

@Module({
  imports: [ServicesModule, TimeSlotsModule, BookingsModule, BookingConfigModule],
})
export class BookingModule {}
