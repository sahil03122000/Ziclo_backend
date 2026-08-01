import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

export class StartBookingDto {
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
