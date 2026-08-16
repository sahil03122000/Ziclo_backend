import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateLeavePolicyDto {
  @ApiPropertyOptional({ example: 4, description: 'Financial year start month, 1-12 (e.g. April = 4)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  financialYearStartMonth?: number;

  @ApiPropertyOptional({ example: 3, description: 'Financial year end month, 1-12 (e.g. March = 3)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  financialYearEndMonth?: number;

  // ── Casual Leave ──────────────────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  casualMonthlyAllocation?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  casualCarryForwardEnabled?: boolean;

  @ApiPropertyOptional({ example: 12, description: 'null/omitted = unlimited carry forward', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  casualCarryForwardLimit?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  casualFinancialYearReset?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  casualEnabled?: boolean;

  // ── Sick Leave ────────────────────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sickYearlyAllocation?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  sickCarryForwardEnabled?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sickCarryForwardLimit?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  sickFinancialYearReset?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  sickEnabled?: boolean;

  // ── Planned Leave ─────────────────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedMonthlyAllocation?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  plannedCarryForwardEnabled?: boolean;

  @ApiPropertyOptional({ description: 'null/omitted = unlimited carry forward', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedCarryForwardLimit?: number | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  plannedFinancialYearReset?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  plannedEnabled?: boolean;

  // ── Paid Leave ────────────────────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  paidMonthlyAllocation?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  paidCarryForwardEnabled?: boolean;

  @ApiPropertyOptional({ description: 'null/omitted = unlimited carry forward', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  paidCarryForwardLimit?: number | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  paidFinancialYearReset?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  paidEnabled?: boolean;

  // ── Approval flow ─────────────────────────────────────────────────────────────
  @ApiPropertyOptional({
    example: false,
    description: 'When true, every manager approval of a leave request escalates to an admin instead of finalizing.',
  })
  @IsOptional()
  @IsBoolean()
  requireAdminLeaveApproval?: boolean;
}
