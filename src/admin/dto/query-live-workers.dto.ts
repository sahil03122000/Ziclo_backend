import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const LIVE_WORKER_STATUSES = ['all', 'active', 'free', 'offline'] as const;

export type LiveWorkerStatusFilter = (typeof LIVE_WORKER_STATUSES)[number];

// Empty-string query params (e.g. `?officeLocationId=&managerId=`) must never fail
// validation — only reject values that were actually supplied and are malformed.
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const toPositiveInt = (fallback: number) => ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
};

export class QueryLiveWorkersDto {
  @ApiPropertyOptional({
    enum: LIVE_WORKER_STATUSES,
    default: 'all',
    description: 'active = checked-in with an in-progress task. free = checked-in, no task. offline = not checked in, checked out, or no location update within 5 minutes.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? 'all' : trimmed.toLowerCase();
  })
  @IsIn(LIVE_WORKER_STATUSES)
  status?: LiveWorkerStatusFilter = 'all';

  @ApiPropertyOptional({ description: 'Filter to workers checked in at this office location (UUID)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  officeLocationId?: string;

  @ApiPropertyOptional({ description: 'Filter to workers managed by this manager (user UUID)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  managerId?: string;

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
