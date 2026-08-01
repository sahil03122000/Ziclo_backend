import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class AreaQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: String,
    description:
      'Office Location UUID(s) — returns only areas linked to at least one of these offices. ' +
      'Accepts a single UUID, a comma-separated list (id1,id2,id3), or repeated query values ' +
      '(?officeLocationIds=id1&officeLocationIds=id2). Empty values are ignored.',
    example:
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890,b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (Array.isArray(value)) {
      const cleaned = value.map((v) => String(v).trim()).filter(Boolean);
      return cleaned.length > 0 ? cleaned : undefined;
    }
    if (typeof value !== 'string') return value;
    const cleaned = value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  })
  @IsArray()
  @IsUUID('4', { each: true })
  officeLocationIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Single Office Location UUID — shorthand for officeLocationIds with one value. ' +
      'If both are provided, officeLocationIds takes precedence. Empty value is ignored.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  })
  @IsUUID('4')
  officeLocationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 20;
}
