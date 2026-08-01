import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import {
  LIVE_TRACKING_STATUSES,
  LiveTrackingStatusFilter,
} from '../../admin/dto/query-live-tracking.dto';

export class ManagerLiveTrackingQueryDto {
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
