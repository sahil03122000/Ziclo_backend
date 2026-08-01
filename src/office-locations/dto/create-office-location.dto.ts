import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateOfficeLocationDto {
  @ApiProperty({ example: 'HDQ Ateli Mandi', description: 'Office location display name', maxLength: 150 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: '1013, Ateli Mandi, Ateli, Haryana, India', description: 'Human-readable street address' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiProperty({ example: 28.0994371, description: 'Latitude in decimal degrees (−90 to 90)' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: 76.2601658, description: 'Longitude in decimal degrees (−180 to 180)' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({ example: 200, description: 'Geofence radius in metres for attendance check-in enforcement (10–50000)', minimum: 10, maximum: 50000 })
  @IsInt()
  @Min(10)
  @Max(50000)
  radius: number;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the Area this office belongs to. Can be omitted and assigned later via PATCH.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  areaId?: string;
}
