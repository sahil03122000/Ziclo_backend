import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ResolveTicketDto {
  @ApiPropertyOptional({ example: 'Cleared cache on user device. Issue was caused by stale session data.' })
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}
