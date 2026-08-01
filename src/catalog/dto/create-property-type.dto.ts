import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreatePropertyTypeDto {
  @ApiProperty({ example: 'Residential' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Homes and apartments' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 1, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'home-icon', description: 'Name resolved against the frontend\'s local icon library. Ignored if iconUrl is also set.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  iconName?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/icons/custom-icon.svg', description: 'Custom uploaded icon URL — takes precedence over iconName when both are present.' })
  @IsOptional()
  @IsString()
  iconUrl?: string;
}
