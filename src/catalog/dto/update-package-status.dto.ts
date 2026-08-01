import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdatePackageStatusDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  isActive: boolean;
}
