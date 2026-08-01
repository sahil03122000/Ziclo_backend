import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AddCommentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'Internal note — visible to MANAGER/ADMIN only' })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
