import { IsOptional, IsString } from 'class-validator';

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
