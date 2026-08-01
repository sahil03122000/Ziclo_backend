import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateServiceStatusDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  isActive: boolean;
}
