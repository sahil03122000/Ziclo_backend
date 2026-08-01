import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const WORKER_ATTENDANCE_STATUSES = [
  'CHECKED_IN',
  'CHECKED_OUT',
  'ABSENT',
  'ON_LEAVE',
  'HALF_DAY',
  'PRESENT',
] as const;

export type WorkerAttendanceStatusFilter =
  (typeof WORKER_ATTENDANCE_STATUSES)[number];

// Empty-string query params (e.g. `?search=&status=`) must never fail validation —
// only reject values that were actually supplied and are malformed.
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

export class QueryWorkersDto {
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
    example: 'Ravi',
    description: 'Search by name, phone, or employee code',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: WORKER_ATTENDANCE_STATUSES,
    description:
      'Filter by attendance status within the date range (or today, if no range is given)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed.toUpperCase();
  })
  @IsIn(WORKER_ATTENDANCE_STATUSES)
  status?: WorkerAttendanceStatusFilter;

  @ApiPropertyOptional({
    description:
      'Narrows which attendance record is joined onto each worker to one recorded at this ' +
      'office location (UUID). Never excludes a worker — a worker with no attendance at this ' +
      'office still appears in the report, shown as ABSENT.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  officeLocationId?: string;

  @ApiPropertyOptional({
    description: 'Filter workers managed by this manager (user UUID)',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({
    description:
      'Narrow the report to a single area (UUID). When combined with managerId, ' +
      "the area must be one of that manager's assigned areas — otherwise the result is empty.",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  areaId?: string;

  @ApiPropertyOptional({
    example: '2026-07-01',
    description:
      'Start of attendance date range (ISO 8601). Defaults to today if omitted.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-07-08',
    description:
      'End of attendance date range (ISO 8601). Defaults to today if omitted.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  endDate?: string;
}
