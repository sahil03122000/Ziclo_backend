import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class RescheduleBookingDto {
  @Type(() => Date)
  @IsDate()
  scheduledAt: Date;

  @IsOptional()
  @IsUUID()
  timeSlotId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}
