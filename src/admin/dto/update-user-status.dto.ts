import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({ example: false, description: 'Set to true to activate, false to deactivate' })
  @IsBoolean()
  @IsNotEmpty()
  isActive: boolean;
}
