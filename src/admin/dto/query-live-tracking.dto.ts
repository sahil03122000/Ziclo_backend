import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const LIVE_TRACKING_ROLES = ['WORKER', 'MANAGER', 'BOTH'] as const;
export type LiveTrackingRoleFilter = (typeof LIVE_TRACKING_ROLES)[number];

export const LIVE_TRACKING_STATUSES = [
  'LIVE',
  'CHECKED_IN',
  'OFFLINE',
] as const;
export type LiveTrackingStatusFilter = (typeof LIVE_TRACKING_STATUSES)[number];

const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class QueryLiveTrackingDto {
  @ApiPropertyOptional({
    enum: LIVE_TRACKING_ROLES,
    default: 'BOTH',
    description: 'WORKER, MANAGER, or BOTH (default)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? 'BOTH' : trimmed.toUpperCase();
  })
  @IsIn(LIVE_TRACKING_ROLES)
  role?: LiveTrackingRoleFilter = 'BOTH';

  @ApiPropertyOptional({
    enum: LIVE_TRACKING_STATUSES,
    description: 'LIVE, CHECKED_IN, or OFFLINE. Omit for all.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed.toUpperCase();
  })
  @IsIn(LIVE_TRACKING_STATUSES)
  status?: LiveTrackingStatusFilter;

  @ApiPropertyOptional({ description: 'Filter by office location UUID' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  officeLocationId?: string;

  @ApiPropertyOptional({
    description:
      "Filter workers to one manager's own team (WORKER/BOTH role only)",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null || value === '' ? 1 : Number(value),
  )
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null || value === '' ? 20 : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
