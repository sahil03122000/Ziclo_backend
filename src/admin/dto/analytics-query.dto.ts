import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export type AnalyticsPeriod = 'today' | 'week' | 'month' | 'year' | 'custom';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: ['today', 'week', 'month', 'year', 'custom'],
    example: 'month',
    description:
      'Preset time window. Omit to default to "month". ' +
      'Use "custom" together with startDate + endDate for an arbitrary range.',
  })
  @IsOptional()
  @IsIn(['today', 'week', 'month', 'year', 'custom'])
  period?: AnalyticsPeriod;

  @ApiPropertyOptional({
    example: '2026-06-01T00:00:00.000Z',
    description: 'Range start (ISO 8601). Used when period="custom" or period is omitted.',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-06-30T23:59:59.999Z',
    description: 'Range end (ISO 8601). Used when period="custom" or period is omitted.',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
