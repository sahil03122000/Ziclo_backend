import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CheckServiceAreaDto {
  @ApiProperty({ example: 'uuid', description: 'Saved address to check for service coverage' })
  @IsUUID()
  addressId: string;
}
