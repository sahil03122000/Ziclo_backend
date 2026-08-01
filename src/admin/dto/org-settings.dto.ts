import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateOrgSettingsDto {
  @ApiPropertyOptional({
    example: 18,
    description: 'Tax percentage applied to invoices (0–100)',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  taxPercentage?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Advance payment percentage required at booking time (0–100)',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  advancePaymentPercentage?: number;

  @ApiPropertyOptional({
    example: 3,
    description: 'Maximum number of concurrent active sessions allowed per user',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxActiveSessions?: number;
}
