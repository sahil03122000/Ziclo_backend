import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
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

export class ManagerAttendanceReportQueryDto {
  @ApiPropertyOptional({
    enum: ['today', 'week', 'month'],
    description:
      'Convenience date range. Ignored if startDate/endDate are also sent.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';

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

  @ApiPropertyOptional({
    description: "Narrow to one worker (must belong to the manager's own team)",
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  workerId?: string;

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
