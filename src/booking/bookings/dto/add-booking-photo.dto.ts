import { TaskPhotoType } from '@prisma/client';
import { IsEnum, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsUrl } from 'class-validator';

export class AddBookingPhotoDto {
  @IsEnum(TaskPhotoType)
  type: TaskPhotoType;

  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  imageUrl: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
