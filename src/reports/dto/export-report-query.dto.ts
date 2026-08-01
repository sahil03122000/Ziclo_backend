import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';

export type ExportReportType =
  | 'overview'
  | 'revenue'
  | 'bookings'
  | 'customers'
  | 'workers'
  | 'managers'
  | 'attendance'
  | 'complaints';

export type ExportReportFormat = 'excel' | 'pdf';

export class ExportReportQueryDto {
  @ApiProperty({
    enum: ['overview', 'revenue', 'bookings', 'customers', 'workers', 'managers', 'attendance', 'complaints'],
    description: 'Report type to export',
  })
  @IsNotEmpty()
  @IsIn(['overview', 'revenue', 'bookings', 'customers', 'workers', 'managers', 'attendance', 'complaints'])
  type: ExportReportType;

  @ApiProperty({ enum: ['excel', 'pdf'], description: 'File format' })
  @IsNotEmpty()
  @IsIn(['excel', 'pdf'])
  format: ExportReportFormat;

  @ApiPropertyOptional({ example: '2026-06-01', description: 'Filter start date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-06-30', description: 'Filter end date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
