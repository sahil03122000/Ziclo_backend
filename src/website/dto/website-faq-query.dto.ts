import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class WebsiteFaqQueryDto {
  @ApiPropertyOptional({ example: 'billing', description: 'Filter by FAQ category' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;
}
