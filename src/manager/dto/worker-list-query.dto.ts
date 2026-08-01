import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const MANAGER_WORKER_STATUSES = [
  'all',
  'active',
  'inactive',
  'present',
  'absent',
] as const;

export type ManagerWorkerStatusFilter =
  (typeof MANAGER_WORKER_STATUSES)[number];

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

export class ManagerWorkerListQueryDto {
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

  @ApiPropertyOptional({
    description: 'Search by name, phone, or employee code',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: MANAGER_WORKER_STATUSES,
    default: 'all',
    description:
      "active/inactive = account status. present/absent = today's attendance.",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? 'all' : trimmed.toLowerCase();
  })
  @IsIn(MANAGER_WORKER_STATUSES)
  status?: ManagerWorkerStatusFilter = 'all';

  @ApiPropertyOptional({
    description: "Narrow to one of the manager's own assigned areas (UUID)",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  areaId?: string;

  @ApiPropertyOptional({
    description: 'Filter to workers checked in at this office location (UUID)',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  officeLocationId?: string;
}
