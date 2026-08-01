import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

import { AdminReportQueryDto } from './admin-report-query.dto';

export class ManagerReportQueryDto extends AdminReportQueryDto {
  @ApiPropertyOptional({ description: 'Filter to a single manager user UUID' })
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({ description: 'Filter active/inactive managers' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
