import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateAreaDto {
  @ApiPropertyOptional({ example: 'Sector 14', description: 'Area name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: '122001',
    description:
      '6-digit India PIN Code — city, district, state and country are resolved automatically',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be exactly 6 digits' })
  pincode?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Replaces all office locations currently linked to this area (an area can belong to ' +
      'multiple offices). At least one is required when provided — either this field or the ' +
      'deprecated officeLocationId. Omit entirely to leave office assignments unchanged.',
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  officeLocationIds?: string[];

  @ApiPropertyOptional({
    deprecated: true,
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description:
      'Deprecated — use officeLocationIds instead. Kept for backward compatibility; ' +
      'converted internally to officeLocationIds: [officeLocationId].',
  })
  @IsOptional()
  @IsUUID()
  officeLocationId?: string;

  @ApiPropertyOptional({ example: 'Bengaluru', description: 'City' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'Karnataka', description: 'State' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ example: true, description: 'Area active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // managerId / managerIds are intentionally accepted-but-ignored: manager assignment is
  // now handled exclusively by the Manager Create/Update APIs, not the Area APIs. They're
  // still declared here (with no validation beyond @IsOptional()) purely so a client that
  // still sends them isn't rejected by the global whitelist ValidationPipe — the values are
  // never read or acted upon.
  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Ignored. Manager assignment is now handled exclusively via the Manager Create/Update APIs.',
  })
  @IsOptional()
  managerId?: unknown;

  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Ignored. Manager assignment is now handled exclusively via the Manager Create/Update APIs.',
  })
  @IsOptional()
  managerIds?: unknown;
}
