import { ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const toPositiveInt =
  (fallback: number) =>
  ({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  };

export class ManagerJobQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ description: 'Filter by service UUID' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({
    description: "Filter to one worker (must belong to the manager's own team)",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  workerId?: string;

  @ApiPropertyOptional({
    description:
      "Filter to one office location (must belong to the manager's own team)",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  officeLocationId?: string;

  @ApiPropertyOptional({
    description: "Filter to one area (must belong to the manager's own team)",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  areaId?: string;

  @ApiPropertyOptional({ description: 'Filter by customer UUID' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Search by booking ref, customer name, or service name',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Transform(toPositiveInt(1))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(toPositiveInt(20))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
