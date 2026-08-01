import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectMissedCheckoutRequestDto {
  @ApiPropertyOptional({ example: 'Not verifiable' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
