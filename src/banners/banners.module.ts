import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { BannersController } from './banners.controller';
import { BannersService } from './banners.service';

@Module({
  imports: [ActivityLogModule],
  controllers: [BannersController],
  providers: [BannersService],
})
export class BannersModule {}
