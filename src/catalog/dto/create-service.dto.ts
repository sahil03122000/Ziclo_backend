import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Optional string fields must never fail validation just because the client
// sent "" instead of omitting the key — @IsOptional() alone only skips
// undefined/null, not empty strings.
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class PricingOptionInputDto {
  @ApiPropertyOptional({ description: 'Existing PricingOption.id — updates that record. Omit to create a new option.' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: '1-3 KW' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  @ApiProperty({ example: 499, description: 'Final price charged when this option is selected' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 1, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PackageInputDto {
  @ApiPropertyOptional({ description: 'Existing Package.id — updates that record. Omit to create a new package.' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'One time' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'One time at' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  description?: string;

  @ApiProperty({
    example: 499,
    description:
      'Legacy flat price — kept for backward compatibility. Once pricingOptions are provided, ' +
      'bookings always price off the selected PricingOption, not this field.',
  })
  @IsNumber()
  @Min(0)
  basePrice: number;

  @ApiPropertyOptional({
    type: [PricingOptionInputDto],
    description:
      'Priced variants for this package (e.g. "1 Unit" ₹399, "2 Units" ₹699). If omitted, a single ' +
      '"Standard" option is created automatically using basePrice, so every package always has at ' +
      'least one selectable pricing option.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingOptionInputDto)
  pricingOptions?: PricingOptionInputDto[];

  @ApiPropertyOptional({ example: 90, description: 'Duration in minutes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  duration?: number;

  @ApiPropertyOptional({ example: 1, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Minimum solar panels covered by this package' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minPanels?: number;

  @ApiPropertyOptional({ description: 'Maximum solar panels covered by this package' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxPanels?: number;

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

export class PropertyTypeInputDto {
  @ApiPropertyOptional({ description: 'Existing PropertyType.id — updates that record. Omit to create a new property type.' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Residential' })
  @IsString()
  @IsNotEmpty()
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

  @ApiProperty({ type: [PackageInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageInputDto)
  packages: PackageInputDto[];

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

export class CreateServiceDto {
  @ApiProperty({ example: 'Solar Cleaning' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Professional solar panel cleaning' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  description?: string;

  @ApiProperty({ example: 'https://cdn.example.com/services/solar-thumb.jpg' })
  @IsString()
  @IsNotEmpty()
  thumbnailImage: string;

  @ApiProperty({ example: 'https://cdn.example.com/services/solar-banner.jpg' })
  @IsString()
  @IsNotEmpty()
  bannerImage: string;

  @ApiProperty({ type: [PropertyTypeInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyTypeInputDto)
  propertyTypes: PropertyTypeInputDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'solar-panel-icon', description: 'Name resolved against the frontend\'s local icon library. Ignored if iconUrl is also set.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  iconName?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/icons/custom-icon.svg', description: 'Custom uploaded icon URL — takes precedence over iconName when both are present.' })
  @IsOptional()
  @IsString()
  iconUrl?: string;
}
