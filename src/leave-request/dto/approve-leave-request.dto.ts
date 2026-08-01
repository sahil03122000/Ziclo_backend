import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveLeaveRequestDto {
  @ApiPropertyOptional({ example: 'Approved' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
