import { Module } from '@nestjs/common';

import { ImageUploadController } from './image-upload.controller';
import { S3Service } from './s3.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController, ImageUploadController],
  providers: [UploadsService, S3Service],
})
export class UploadsModule {}
