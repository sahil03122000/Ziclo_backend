import { Module } from '@nestjs/common';

import { S3Service } from '../uploads/s3.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, S3Service],
})
export class HealthModule {}
