import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CorrectAttendanceDto {
  @ApiPropertyOptional({ description: 'Corrected check-in time (ISO 8601)', example: '2024-01-15T09:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  checkInTime?: string;

  @ApiPropertyOptional({ description: 'Corrected check-out time (ISO 8601)', example: '2024-01-15T18:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  checkOutTime?: string;

  @ApiPropertyOptional({ description: 'Reason for the correction (stored in audit log)', example: 'System downtime prevented check-in' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
