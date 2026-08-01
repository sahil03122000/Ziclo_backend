import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

import { AdminReportQueryDto } from './admin-report-query.dto';

export class AttendanceReportQueryDto extends AdminReportQueryDto {
  @ApiPropertyOptional({ enum: ['worker', 'manager'], default: 'worker', description: 'Employee type to report on' })
  @IsOptional()
  @IsIn(['worker', 'manager'])
  type?: 'worker' | 'manager';

  @ApiPropertyOptional({ description: 'Filter by specific employee user UUID' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by area UUID (workers only)' })
  @IsOptional()
  @IsUUID()
  areaId?: string;
}
