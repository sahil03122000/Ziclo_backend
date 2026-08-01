import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class ResubmitMissedCheckoutRequestDto {
  @ApiProperty({ example: 'Forgot to check out before leaving the site' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({
    example: '2026-07-21T18:00:00Z',
    description: 'The time the worker claims they actually left — recalculated working hours and the default approval check-out time are both based on this unless an approver overrides it.',
  })
  @IsOptional()
  @IsDateString()
  requestedCheckOutTime?: string;

  @ApiPropertyOptional({ example: 'Was on an emergency job till late' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    description: 'Supporting image URL. Upload via POST /api/v1/uploads/image first.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  imageUrl?: string;
}
