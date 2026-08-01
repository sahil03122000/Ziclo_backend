import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateAreaDto {
  @ApiProperty({ example: 'Sector 14', description: 'Area name' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: '122001',
    description:
      '6-digit India PIN Code — city, district, state and country are resolved automatically',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be exactly 6 digits' })
  pincode: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Office Location UUIDs to associate with this area (an area can belong to multiple offices). ' +
      'At least one is required — either this field or the deprecated officeLocationId.',
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

  @ApiProperty({ example: true, description: 'Area active status' })
  @IsBoolean()
  isActive: boolean;
}
