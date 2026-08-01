import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveMissedCheckoutRequestDto {
  @ApiPropertyOptional({ example: 'Confirmed with site supervisor' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiPropertyOptional({
    example: '2026-07-20T18:00:00Z',
    description:
      'Approved check-out time, overriding the worker\'s requestedCheckOutTime. Required if the worker has not submitted one yet.',
  })
  @IsOptional()
  @IsDateString()
  checkOutTime?: string;
}
