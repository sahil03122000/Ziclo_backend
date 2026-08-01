import { IsNotEmpty, IsNumber, IsUrl, IsUUID, Max, Min } from 'class-validator';

export class CheckInDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  selfieImageUrl: string;

  @IsUUID()
  @IsNotEmpty()
  officeLocationId: string;
}
