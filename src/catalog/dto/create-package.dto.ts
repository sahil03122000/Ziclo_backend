import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreatePackageDto {
  @ApiProperty({ example: '1-3 KW' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Residential Cleaning' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 499 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 90, description: 'Duration in minutes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 1, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'wrench-icon', description: 'Name resolved against the frontend\'s local icon library. Ignored if iconUrl is also set.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  iconName?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/icons/custom-icon.svg', description: 'Custom uploaded icon URL — takes precedence over iconName when both are present.' })
  @IsOptional()
  @IsString()
  iconUrl?: string;
}
