import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectLeaveRequestDto {
  @ApiPropertyOptional({ example: 'Insufficient staffing on requested date' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
