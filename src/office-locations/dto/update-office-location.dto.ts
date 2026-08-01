import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class UpdateOfficeLocationDto {
  @ApiPropertyOptional({ example: 'HDQ Ateli Mandi', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ example: '1013, Ateli Mandi, Ateli, Haryana, India', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 28.0994371, description: 'Latitude in decimal degrees (−90 to 90)' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 76.2601658, description: 'Longitude in decimal degrees (−180 to 180)' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ example: 200, minimum: 10, maximum: 50000 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(50000)
  radius?: number;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    nullable: true,
    description: 'Assign an Area (UUID), reassign to a different Area, or send null to remove the Area association.',
  })
  @IsOptional()
  @IsUUID()
  // @IsOptional() treats both undefined and null as "empty" — UUID validation is skipped for null,
  // allowing explicit null to mean "disconnect from area".
  areaId?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
